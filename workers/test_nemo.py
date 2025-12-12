#!/usr/bin/env python3
"""
Quick test to see what NeMo Parakeet returns
"""
import nemo.collections.asr as nemo_asr

print("Loading model...")
# Try the official API as shown in docs
asr_model = nemo_asr.models.ASRModel.from_pretrained(
    model_name="nvidia/parakeet-tdt-0.6b-v2"
)

print(f"Model type: {type(asr_model)}")
print(f"Model class: {asr_model.__class__.__name__}")

# Create a test audio file path (we'll use one from the server)
test_audio = "/workspace/tmp/test.wav"  # We'll create this

print(f"\nTranscribing test audio...")
results = asr_model.transcribe([test_audio])

print(f"\nResults type: {type(results)}")
print(f"Results length: {len(results)}")
print(f"First result type: {type(results[0])}")
print(f"First result: {results[0]}")

if hasattr(results[0], 'text'):
    print(f"Text attribute: '{results[0].text}'")
    print(f"Text length: {len(results[0].text)}")

if hasattr(results[0], '__dict__'):
    print(f"Attributes: {results[0].__dict__}")

print("\nDone!")
