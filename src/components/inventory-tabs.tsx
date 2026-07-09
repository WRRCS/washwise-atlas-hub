import { Link } from "@tanstack/react-router";

export function InventoryTabs({ current }: { current: "items" | "recipes" | "usage" }) {
  const tabs = [
    { key: "items", label: "Items", to: "/inventory" },
    { key: "recipes", label: "Recipes", to: "/inventory/recipes" },
    { key: "usage", label: "Usage report", to: "/inventory/usage" },
  ] as const;
  return (
    <div className="flex gap-1 border-b border-border/60 -mt-2 mb-2">
      {tabs.map((t) => (
        <Link
          key={t.key}
          to={t.to}
          className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${
            current === t.key
              ? "border-brand text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
