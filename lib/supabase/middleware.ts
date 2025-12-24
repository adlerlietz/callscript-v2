import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Updates Supabase auth session in middleware.
 * Required to refresh expired sessions and keep users logged in.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // IMPORTANT: Do not add code between createServerClient and supabase.auth.getUser()
  // A simple mistake could make your app vulnerable to security issues.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Demo routes bypass all auth - allow public access to /demo and /api/demo
  const isDemoRoute = request.nextUrl.pathname.startsWith("/demo") ||
                      request.nextUrl.pathname.startsWith("/api/demo");
  if (isDemoRoute) {
    return supabaseResponse;
  }

  // Define protected and public routes
  const isLoginPage = request.nextUrl.pathname === "/login";
  const isSignupPage = request.nextUrl.pathname === "/signup";
  const isOnboardPage = request.nextUrl.pathname === "/onboard";
  const isNoAccessPage = request.nextUrl.pathname === "/no-access";
  const isPublicRoute = request.nextUrl.pathname.startsWith("/api/public") || request.nextUrl.pathname.startsWith("/api/debug");
  const isAuthCallback = request.nextUrl.pathname === "/auth/callback";
  // Note: /api/health now requires auth, so it's not in the public list
  const isOnboardApi = request.nextUrl.pathname === "/api/onboard";
  const isApiRoute = request.nextUrl.pathname.startsWith("/api/");

  // Public pages that don't require auth
  const isPublicPage = isLoginPage || isSignupPage || isNoAccessPage;

  // If no user and trying to access protected route, redirect to signup
  if (!user && !isPublicPage && !isPublicRoute && !isAuthCallback) {
    const url = request.nextUrl.clone();
    url.pathname = "/signup";
    return NextResponse.redirect(url);
  }

  // If user is logged in but has no org, redirect to onboard
  // (unless already on onboard page or API routes)
  if (user && !isLoginPage && !isSignupPage && !isOnboardPage && !isNoAccessPage && !isAuthCallback && !isApiRoute) {
    const orgId = user.app_metadata?.org_id;
    if (!orgId) {
      const url = request.nextUrl.clone();
      url.pathname = "/onboard";
      return NextResponse.redirect(url);
    }
  }

  // If user has org and is on login/signup/onboard page, redirect to dashboard
  if (user && (isLoginPage || isSignupPage || isOnboardPage)) {
    const orgId = user.app_metadata?.org_id;
    if (orgId) {
      const url = request.nextUrl.clone();
      url.pathname = "/dashboard";
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}
