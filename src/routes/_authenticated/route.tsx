import { createFileRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { AppHeader } from "@/components/AppHeader";
import { TourCoach } from "@/components/TourCoach";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  component: Layout,
});

function Layout() {
  const wide = useRouterState({ select: (s) => s.location.pathname === "/run" });
  return (
    <div className="min-h-screen md:flex">
      <AppHeader />
      <main className={`w-full min-w-0 flex-1 px-6 py-10 ${wide ? "" : "mx-auto max-w-[1120px]"}`}><Outlet /></main>
      <TourCoach />
    </div>
  );
}
