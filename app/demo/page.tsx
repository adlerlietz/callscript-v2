import { redirect } from "next/navigation";

/**
 * Demo landing page - redirects to demo dashboard
 */
export default function DemoPage() {
  redirect("/demo/dashboard");
}
