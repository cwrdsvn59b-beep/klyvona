import { Link } from "@tanstack/react-router";

export function LegalLinks({ className = "" }: { className?: string }) {
  return (
    <nav aria-label="מידע משפטי" className={`flex flex-wrap gap-x-4 gap-y-2 text-sm text-muted ${className}`}>
      <Link to="/privacy" className="underline-offset-4 hover:underline">
        מדיניות פרטיות
      </Link>
      <Link to="/data-deletion" className="underline-offset-4 hover:underline">
        מחיקת מידע
      </Link>
    </nav>
  );
}
