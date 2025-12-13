"""
CallScript V2 - Circuit Breaker Pattern

Prevents cascading failures when external services are down.
Implements the circuit breaker pattern with three states:
- CLOSED: Normal operation, requests pass through
- OPEN: Service is down, fail fast without calling
- HALF_OPEN: Testing if service has recovered

Usage:
    breaker = CircuitBreaker("ringba_api", failure_threshold=5, recovery_timeout=60)

    try:
        result = breaker.call(lambda: requests.get(url))
    except CircuitOpenError:
        # Service is down, handle gracefully
        pass
"""

import time
import logging
from enum import Enum
from typing import Callable, TypeVar, Any
from dataclasses import dataclass
from threading import Lock

logger = logging.getLogger("worker")

T = TypeVar("T")


class CircuitState(Enum):
    CLOSED = "closed"      # Normal operation
    OPEN = "open"          # Failing fast
    HALF_OPEN = "half_open"  # Testing recovery


class CircuitOpenError(Exception):
    """Raised when circuit is open and calls are rejected."""

    def __init__(self, name: str, until: float):
        self.name = name
        self.until = until
        remaining = max(0, until - time.time())
        super().__init__(f"Circuit '{name}' is OPEN (retry in {remaining:.0f}s)")


@dataclass
class CircuitStats:
    """Statistics for a circuit breaker."""
    failures: int = 0
    successes: int = 0
    last_failure_time: float = 0
    last_success_time: float = 0
    state: CircuitState = CircuitState.CLOSED
    open_until: float = 0


class CircuitBreaker:
    """
    Circuit breaker for protecting external service calls.

    Args:
        name: Identifier for this circuit (e.g., "ringba_api")
        failure_threshold: Number of failures before opening circuit
        recovery_timeout: Seconds to wait before testing recovery
        success_threshold: Successes needed in half-open to close circuit
    """

    def __init__(
        self,
        name: str,
        failure_threshold: int = 5,
        recovery_timeout: int = 60,
        success_threshold: int = 2,
    ):
        self.name = name
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self.success_threshold = success_threshold

        self._lock = Lock()
        self._stats = CircuitStats()

    @property
    def state(self) -> CircuitState:
        """Current circuit state."""
        with self._lock:
            return self._get_state_unlocked()

    def _get_state_unlocked(self) -> CircuitState:
        """Get state without acquiring lock (caller must hold lock)."""
        if self._stats.state == CircuitState.OPEN:
            if time.time() >= self._stats.open_until:
                self._stats.state = CircuitState.HALF_OPEN
                self._stats.successes = 0
                logger.info(f"Circuit '{self.name}' transitioning to HALF_OPEN")
        return self._stats.state

    def call(self, func: Callable[[], T], *args, **kwargs) -> T:
        """
        Execute function through the circuit breaker.

        Args:
            func: Function to call
            *args, **kwargs: Arguments to pass to function

        Returns:
            Result of function call

        Raises:
            CircuitOpenError: If circuit is open
            Exception: Any exception from the wrapped function
        """
        with self._lock:
            state = self._get_state_unlocked()

            if state == CircuitState.OPEN:
                raise CircuitOpenError(self.name, self._stats.open_until)

        # Execute the call (outside lock to avoid blocking)
        try:
            result = func(*args, **kwargs)
            self._record_success()
            return result

        except Exception as e:
            self._record_failure(e)
            raise

    def _record_success(self) -> None:
        """Record a successful call."""
        with self._lock:
            self._stats.successes += 1
            self._stats.last_success_time = time.time()

            if self._stats.state == CircuitState.HALF_OPEN:
                if self._stats.successes >= self.success_threshold:
                    self._stats.state = CircuitState.CLOSED
                    self._stats.failures = 0
                    logger.info(f"Circuit '{self.name}' CLOSED (service recovered)")

    def _record_failure(self, error: Exception) -> None:
        """Record a failed call."""
        with self._lock:
            self._stats.failures += 1
            self._stats.last_failure_time = time.time()

            if self._stats.state == CircuitState.HALF_OPEN:
                # Any failure in half-open reopens the circuit
                self._open_circuit()
                logger.warning(f"Circuit '{self.name}' reopened from HALF_OPEN: {error}")

            elif self._stats.state == CircuitState.CLOSED:
                if self._stats.failures >= self.failure_threshold:
                    self._open_circuit()
                    logger.error(
                        f"Circuit '{self.name}' OPENED after {self._stats.failures} failures: {error}"
                    )

    def _open_circuit(self) -> None:
        """Open the circuit (caller must hold lock)."""
        self._stats.state = CircuitState.OPEN
        self._stats.open_until = time.time() + self.recovery_timeout
        self._stats.successes = 0

    def reset(self) -> None:
        """Manually reset the circuit to closed state."""
        with self._lock:
            self._stats = CircuitStats()
            logger.info(f"Circuit '{self.name}' manually reset")

    def get_stats(self) -> dict:
        """Get circuit statistics."""
        with self._lock:
            return {
                "name": self.name,
                "state": self._get_state_unlocked().value,
                "failures": self._stats.failures,
                "successes": self._stats.successes,
                "open_until": self._stats.open_until if self._stats.state == CircuitState.OPEN else None,
            }


# Global circuit breakers for common services
_circuits: dict[str, CircuitBreaker] = {}


def get_circuit(
    name: str,
    failure_threshold: int = 5,
    recovery_timeout: int = 60,
) -> CircuitBreaker:
    """
    Get or create a named circuit breaker.

    Args:
        name: Circuit identifier
        failure_threshold: Failures before opening
        recovery_timeout: Seconds before testing recovery

    Returns:
        CircuitBreaker instance
    """
    if name not in _circuits:
        _circuits[name] = CircuitBreaker(
            name=name,
            failure_threshold=failure_threshold,
            recovery_timeout=recovery_timeout,
        )
    return _circuits[name]


def get_all_circuit_stats() -> list[dict]:
    """Get stats for all circuits."""
    return [circuit.get_stats() for circuit in _circuits.values()]
