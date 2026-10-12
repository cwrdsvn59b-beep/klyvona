import { Link, createFileRoute } from "@tanstack/react-router";
import { BrandMark } from "@/components/brand-mark";
import { LegalLinks } from "@/components/legal-links";
import { LEGAL_UPDATED } from "@/lib/legal";

export const Route = createFileRoute("/data-deletion")({
  head: () => ({
    meta: [
      { title: "מחיקת מידע – KLYVONA" },
      {
        name: "description",
        content: "איך לבקש מחיקה של מידע אישי וניתוק של Instagram ב-KLYVONA Connect.",
      },
    ],
  }),
  component: DataDeletionPage,
});

function DataDeletionPage() {
  return (
    <main className="mx-auto min-h-screen w-full max-w-xl px-4 py-8">
      <div className="flex items-center gap-3">
        <BrandMark className="h-12 w-12 rounded-xl" />
        <div>
          <p className="text-lg font-semibold tracking-wide">KLYVONA</p>
          <p className="text-sm text-muted">מחיקת מידע</p>
        </div>
      </div>
      <h1 className="mt-8 text-3xl font-semibold tracking-tight">מחיקת מידע אישי</h1>
      <p className="mt-2 text-sm text-muted">עודכן לאחרונה: {LEGAL_UPDATED}</p>
      <div className="mt-8 space-y-3 text-sm leading-relaxed">
        <p>המחיקה אינה אוטומטית. שליחת בקשה אינה מוחקת לבדה רשומה ממסד הנתונים ואינה מבטלת אסימון אצל Meta.</p>
        <h2 className="pt-2 text-lg font-semibold">ניתוק Instagram</h2>
        <p>
          במסך <Link to="/connect" className="underline-offset-4 hover:underline">חיבור Instagram</Link>, באותו
          דפדפן שבו נשמרה ההצטרפות, אפשר לנתק את החשבון. השרת מוחק את האסימון השמור ואת מזהה חשבון Instagram
          של אותו לקוח. פרטי ההצטרפות נשארים.
        </p>
        <h2 className="pt-2 text-lg font-semibold">בקשה למחיקת פרטי ההצטרפות</h2>
        <p>
          כדי לבקש מחיקה של שם העסק, איש הקשר, הדוא״ל, הטלפון, תיאור העסק וההעדפות, יש לפנות למפעיל KLYVONA
          ולבקש מחיקה. כדאי לציין את מספר הפנייה. במערכת אין כתובת דוא״ל מפורסמת לפנייה הזו, ולכן אי אפשר
          להשלים אותה מתוך העמוד עד שכתובת מאומתת תפורסם בעמוד{" "}
          <Link to="/privacy" className="underline-offset-4 hover:underline">
            מדיניות הפרטיות
          </Link>
          .
        </p>
        <p>
          אחרי שהמפעיל מזהה את הפנייה ומוחק את הרשומה, פרטי ההצטרפות ואסימון הגישה השמור אינם אמורים להישאר
          במסד. אין במוצר משימה אוטומטית שמוודאת את המחיקה, ואין התחייבות למועד קבוע.
        </p>
        <p>אפשר גם להסיר את הרשאת היישום מתוך הגדרות Instagram. פעולה זו אינה מוחקת את טופס ההצטרפות אצלנו.</p>
      </div>
      <LegalLinks className="mt-10" />
    </main>
  );
}
