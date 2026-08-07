# VRP Road Solver

وب‌اپ فارسی برای حل **Capacitated Vehicle Routing Problem (CVRP)** و نمایش مسیر واقعی خودروها روی نقشه OpenStreetMap.

## امکانات

- انتخاب دپو با کلیک روی نقشه، مختصات دستی یا موقعیت فعلی مرورگر
- افزودن مشتری با مختصات و مقدار تقاضا
- حذف مستقل هر مشتری و حذف جداگانه دپو بدون پاک‌شدن سایر نقاط
- تعیین تعداد خودرو و ظرفیت هر خودرو
- گرفتن ماتریس فاصله/زمان جاده‌ای از OSRM
- حل CVRP در مرورگر با Clarke–Wright Savings + 2-opt
- نمایش مسیر واقعی هر خودرو روی خیابان‌ها با OSRM Route API
- نمایش مسافت، زمان، بار و ترتیب بازدید هر خودرو
- ورود/خروج JSON برای ذخیره سناریوها
- بدون دیتابیس، بدون API key، بدون dependency در build
- آماده GitHub و Vercel

## اجرای محلی

نیازمندی: Python 3 (فقط برای وب‌سرور محلی)

```bash
npm run dev
```

یا:

```bash
python3 -m http.server 5173 -d public
```

بعد `http://localhost:5173` را باز کنید.

## Build

```bash
npm run build
```

خروجی در پوشه `dist/` ساخته می‌شود.

## انتشار در GitHub

```bash
git init
git add .
git commit -m "Initial VRP web app"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

## Deploy روی Vercel

### روش GitHub

1. Repository را در GitHub بسازید و این پروژه را push کنید.
2. در Vercel گزینه **Add New → Project** را بزنید.
3. Repository را Import کنید.
4. Build Command: `npm run build`
5. Output Directory: `dist`
6. Deploy.

فایل `vercel.json` همین تنظیمات را همراه پروژه دارد.

### روش سریع بدون GitHub

می‌توانید خود پوشه یا ZIP پروژه را در Vercel Drop قرار دهید؛ برای workflow اصلی پروژه پیشنهاد می‌شود بعداً GitHub را به پروژه متصل کنید.

## الگوریتم

1. ماتریس جاده‌ای با OSRM Table API ساخته می‌شود.
2. Clarke–Wright Savings با قید ظرفیت، مسیرها را می‌سازد.
3. برای رعایت تعداد خودرو، ادغام مسیرهای ظرفیت‌پذیر انجام می‌شود و fallback تخصیص ظرفیت وجود دارد.
4. 2-opt ترتیب مشتری‌های هر مسیر را بهبود می‌دهد.
5. OSRM Route API هندسه واقعی خیابان‌ها را برمی‌گرداند و Leaflet آن را روی OpenStreetMap رسم می‌کند.

این روش heuristic است و **تضمین بهینه سراسری** نمی‌دهد؛ برای پروژه آموزشی/نمونه‌سازی و تعداد نقطه متوسط مناسب است.

## سرویس‌های رایگان و محدودیت‌ها

- **Leaflet:** کتابخانه متن‌باز نقشه.
- **OpenStreetMap:** داده نقشه آزاد؛ tile server عمومی ظرفیت محدود و بدون SLA دارد و Attribution باید نمایش داده شود.
- **OSRM:** موتور متن‌باز مسیریابی. این پروژه از demo endpoint عمومی `router.project-osrm.org` استفاده می‌کند؛ برای ترافیک سنگین یا محصول تجاری بهتر است OSRM را self-host کنید.
- **Vercel Hobby:** برای پروژه‌های شخصی/غیرتجاری رایگان است و محدودیت/شرایط Fair Use دارد.
- برای رعایت استفاده سبک از سرویس عمومی، UI تعداد مشتری را به 60 محدود کرده است.

## ساختار

```text
vrp-webapp/
├── public/
│   ├── index.html
│   ├── app.js
│   └── styles.css
├── build.mjs
├── package.json
├── vercel.json
├── README.md
├── LICENSE
└── .gitignore
```

## License

MIT


## نسخه 1.0.2
- نمای اولیه و دکمه پاک‌سازی، نقشه را روی کل کشور ایران تنظیم می‌کنند.
