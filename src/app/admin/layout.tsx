import Link from "next/link";
import { requireAdmin } from "@/lib/admin";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();

  return (
    <div className="space-y-6">
      <nav className="no-print flex flex-wrap gap-1.5 rounded-card bg-forest p-2 text-sm">
        {[
          ["/admin/run-sheet", "Run sheet"],
          ["/admin/gift-notes", "Gift notes"],
        ].map(([href, label]) => (
          <Link
            key={href}
            href={href!}
            className="rounded px-3 py-2 font-medium text-cream hover:bg-white/10"
          >
            {label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
