import { Link, createFileRoute } from "@tanstack/react-router";
import { BrandMark } from "@/components/brand-mark";
import { LegalLinks } from "@/components/legal-links";
import { LEGAL_UPDATED } from "@/lib/legal";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "מדיניות פרטיות – KLYVONA" },
      {
        name: "description",
        content: "מדיניות הפרטיות של KLYVONA Connect: הצטרפות עסקים וחיבור חשבון Instagram מקצועי.",
      },
    ],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <main className="mx-auto min-h-screen w-full max-w-xl px-4 py-8">
      <div className="flex items-center gap-3">
        <BrandMark className="h-12 w-12 rounded-xl" />
        <div>
          <p className="text-lg font-semibold tracking-wide">KLYVONA</p>
          <p className="text-sm text-muted">מדיניות פרטיות</p>
        </div>
      </div>
      <h1 className="mt-8 text-3xl font-semibold tracking-tight">מדיניות פרטיות – KLYVONA</h1>
      <p className="mt-2 text-sm text-muted">עודכן לאחרונה: {LEGAL_UPDATED}</p>

      <section className="mt-8 space-y-3 text-sm leading-relaxed">
        <h2 className="text-lg font-semibold">מי מפעיל את השירות</h2>
        <p>
          KLYVONA הוא שם המותג של השירות בכתובת האתר הזה. המוצר לא מציג שם של חברה בע״מ, מספר עוסק או כתובת
          רשומה, ואין להסיק מכאן שהשירות רשום כחברה. המפעיל הוא העסק שמפעיל את KLYVONA.
        </p>
        <p>
          במערכת לא הוגדרה כתובת דוא״ל ציבורית לפניות פרטיות. עד שכתובת כזו תפורסם במדיניות הזו, אין במסמך כתובת
          ליצירת קשר ואין לשלוח מידע רגיש לערוץ שלא מופיע כאן.
        </p>
      </section>

      <section className="mt-8 space-y-3 text-sm leading-relaxed">
        <h2 className="text-lg font-semibold">מה השירות עושה</h2>
        <p>
          KLYVONA Connect עוזר ללקוחות עסקיים להשאיר פרטי עסק והעדפות תוכן, ולחבר חשבון Instagram מקצועי
          שבשליטתם. הלקוח לא מתבקש למסור סיסמה של Instagram. חיבור החשבון נעשה דרך Instagram Login של Meta, ורק
          אם השרת הוגדר לכך.
        </p>
        <p>
          פרסום אוטומטי לחשבונות של לקוחות אינו מתואר כאן כפעולה שכבר אושרה על ידי Meta. הפקת וידאו אינה כלולה
          במסלולים שמוצגים בטופס.
        </p>
      </section>

      <section className="mt-8 space-y-3 text-sm leading-relaxed">
        <h2 className="text-lg font-semibold">מידע שנאסף בהצטרפות</h2>
        <p>בטופס ההצטרפות נשמרים הפרטים שהלקוח מזין:</p>
        <ul className="list-disc space-y-1 pe-5">
          <li>שם העסק, שם איש הקשר, דוא״ל וטלפון</li>
          <li>תחום, תיאור העסק, קהל יעד, שירותים, טון דיבור וסגנון ויזואלי</li>
          <li>המסלול שנבחר</li>
        </ul>
        <p>
          בנוסף נוצרים מספר פנייה, סטטוס ההצטרפות וסטטוס המסלול. הטופס לא גובה כרטיס אשראי. טיוטת הטופס נשמרת
          בדפדפן של הלקוח, ב-sessionStorage של אותו אתר, עד השליחה או הרענון של הפנייה. היא לא נשלחת לשרת לפני
          השליחה.
        </p>
      </section>

      <section className="mt-8 space-y-3 text-sm leading-relaxed">
        <h2 className="text-lg font-semibold">מידע מ-Instagram ומ-Meta</h2>
        <p>
          אם הלקוח בוחר לחבר Instagram, הבקשה כוללת את ההרשאות instagram_business_basic ו-instagram_business_content_publish.
          Meta עשויה להחזיר מזהה של חשבון מקצועי, שם משתמש, סוג חשבון, רשימת הרשאות אם היא נכללת בתשובה, ואסימון
          גישה. הסיסמה של Instagram לא מגיעה אל KLYVONA.
        </p>
        <p>
          לצורך ההגנה על תהליך החיבור נשמרת עוגיית מצב קצרה, לכעשר דקות, ורשומת אישור זמנית לכחמש עשרה דקות.
          אלה לא מחליפים את פרטי ההצטרפות.
        </p>
      </section>

      <section className="mt-8 space-y-3 text-sm leading-relaxed">
        <h2 className="text-lg font-semibold">למה המידע משמש</h2>
        <ul className="list-disc space-y-1 pe-5">
          <li>קליטת הפנייה וזיהוי העסק</li>
          <li>חיבור חשבון Instagram שהלקוח אישר, ובדיקת זהות החשבון</li>
          <li>שמירת סטטוס ההרשאה שחזר מ-Meta, בלי להמציא הרשאה שלא הוחזרה</li>
          <li>תפעול השירות, אבטחה ומניעת חיבור של חשבון ללקוח אחר</li>
          <li>הודעה תפעולית למערכת האוטומציה, אם היא הוגדרה, בלי אסימונים ובלי פרטי קשר</li>
        </ul>
      </section>

      <section className="mt-8 space-y-3 text-sm leading-relaxed">
        <h2 className="text-lg font-semibold">איך נשמר אסימון הגישה</h2>
        <p>
          אסימון הגישה נשמר בשרת, במסד PostgreSQL, אחרי הצפנת AES-GCM. מפתח ההצפנה נשאר בשרת ולא נשלח לדפדפן.
          האסימון לא מוצג ללקוח ולא נשלח אל Make. ניתוק Instagram מוחק את האסימון השמור, את מועד התפוגה ואת מזהה
          החשבון מאותה שורת חיבור. פעולה זו לא מוחקת את פרטי ההצטרפות.
        </p>
      </section>

      <section className="mt-8 space-y-3 text-sm leading-relaxed">
        <h2 className="text-lg font-semibold">גורמים נוספים</h2>
        <ul className="list-disc space-y-1 pe-5">
          <li>Meta, לצורך Instagram Login והרשאות שהלקוח מאשר שם.</li>
          <li>Neon, כמסד PostgreSQL של סביבת הייצור כאשר החיבור למסד הוגדר.</li>
          <li>
            Make.com, רק אם הוגדרה כתובת שרת. ההודעה כוללת מזהה פנייה וסטטוסים, לא דוא״ל, לא טלפון ולא אסימון.
          </li>
        </ul>
        <p>
          כניסת הצוות נפרדת מהלקוחות ומשתמשת ב-Google או ב-X. לקוח לא נדרש להתחבר כדי למלא את טופס ההצטרפות.
        </p>
      </section>

      <section className="mt-8 space-y-3 text-sm leading-relaxed">
        <h2 className="text-lg font-semibold">כמה זמן המידע נשמר</h2>
        <p>
          אין במערכת מחיקה אוטומטית של פרטי לקוח ואין תקופת שמירה קבועה שרצה מעצמה. פרטי ההצטרפות והחיבור נשארים
          עד שהמפעיל מוחק אותם בפועל, או עד שהלקוח מנתק את Instagram ומסיר את האסימון כמתואר למעלה. רשומות
          האישור הזמניות של OAuth פגות מעצמן.
        </p>
      </section>

      <section className="mt-8 space-y-3 text-sm leading-relaxed">
        <h2 className="text-lg font-semibold">זכויות עיון ותיקון</h2>
        <p>
          לקוח יכול לבקש לדעת אילו פרטי הצטרפות שמורים עליו ולבקש תיקון של פרט שגוי. אין באתר אזור אישי שמייצא
          את כל המידע. הבקשה מטופלת על ידי המפעיל אחרי זיהוי סביר של הפונה, למשל באמצעות מספר הפנייה ופרטי הקשר
          שנמסרו בטופס. אין במערכת כתובת דוא״ל מפורסמת לשליחת הבקשה.
        </p>
      </section>

      <section className="mt-8 space-y-3 text-sm leading-relaxed">
        <h2 className="text-lg font-semibold">ניתוק Instagram</h2>
        <p>
          במסך <Link to="/connect" className="underline-offset-4 hover:underline">חיבור Instagram</Link>, באותו
          דפדפן שבו הושלמה ההצטרפות, אפשר לבקש ניתוק. השרת מסיר את האסימון ואת מזהה החשבון של אותו לקוח. אפשר
          גם להסיר את ההרשאה מתוך הגדרות Instagram של Meta. הסרה שם לא מוחקת לבדה את פרטי ההצטרפות השמורים
          אצלנו.
        </p>
      </section>

      <section className="mt-8 space-y-3 text-sm leading-relaxed">
        <h2 className="text-lg font-semibold">בקשה למחיקת מידע</h2>
        <p>
          אין באתר כפתור שמוחק אוטומטית את כל המידע האישי, ואין כתובת שרת שמוחקת רשומה ברגע שנשלחת בקשה. בקשת
          מחיקה דורשת טיפול של המפעיל. עד להשלמת הטיפול המידע נשאר שמור. פירוט נוסף נמצא בעמוד{" "}
          <Link to="/data-deletion" className="underline-offset-4 hover:underline">
            מחיקת מידע
          </Link>
          .
        </p>
      </section>

      <section className="mt-8 space-y-3 text-sm leading-relaxed">
        <h2 className="text-lg font-semibold">אבטחה</h2>
        <p>
          אסימונים מוצפנים לפני השמירה, סודות השרת לא נשלחים לדפדפן, וגישת הניהול מוגבלת לצוות מורשה. אלה אמצעי
          הגנה שקיימים במערכת. הם אינם אישור תקן ואינם הבטחה שלא תתרחש תקלה או גישה לא מורשית.
        </p>
      </section>

      <section className="mt-8 space-y-3 text-sm leading-relaxed">
        <h2 className="text-lg font-semibold">שינויים במדיניות</h2>
        <p>כשהמדיניות משתנה, תאריך העדכון בראש העמוד מתעדכן. הנוסח שמוצג באתר הוא הנוסח שבתוקף.</p>
      </section>

      <section className="mt-8 space-y-3 text-sm leading-relaxed">
        <h2 className="text-lg font-semibold">יצירת קשר</h2>
        <p>
          כתובת דוא״ל, שם משפטי ומספר עוסק של מפעיל KLYVONA לא הוגדרו במוצר ולכן אינם מופיעים כאן. אין להמציא
          נמען. כשתפורסם כתובת מאומתת, היא תופיע בעמוד זה.
        </p>
      </section>

      <LegalLinks className="mt-10" />
    </main>
  );
}
