# اپتی‌مسیر (OptiMasir) v2.2.1

وب‌اپ فارسی برای تعریف، حل و تحلیل یک مدل ایستای **Heterogeneous Capacitated Vehicle Routing Problem** روی شبکه جاده‌ای OpenStreetMap/OSRM. این نسخه علاوه بر فاصله و زمان، **هزینه کل عملیات**، محدودیت‌های اختیاری خودرو، ورود گروهی CSV/XLSX، داشبورد KPI، گزارش کران پایین و Optimality Gap، مقایسه سناریو و اولویت نرم/سخت را پشتیبانی می‌کند.

## قابلیت‌های اصلی

- ثبت و ویرایش مستقل دپو و مشتری‌ها با نقشه یا مختصات
- پین موقت برای نمایش دقیق نقطه‌ای که کاربر قبل از ثبت انتخاب کرده است
- تقاضای یک‌بعدی با واحد انتخابی مشترک
- ناوگان ناهمگن؛ هر خودرو ظرفیت، نوع و وضعیت فعال مستقل دارد
- هزینه مستقل هر خودرو: **هزینه ثابت اعزام + هزینه هر کیلومتر + هزینه هر دقیقه**
- محدودیت‌های اختیاری هر خودرو: حداکثر مسافت، حداکثر مدت مأموریت، حداکثر تعداد توقف و الزام/عدم الزام بازگشت به دپو
- سه تابع هدف: فاصله، زمان سفر برآوردی، یا هزینه کل ناوگان
- سناریوهای مصنوعی ترافیک سبک/متوسط/سنگین برای تحلیل حساسیت؛ این داده‌ها ترافیک واقعی نیستند
- سیاست اولویت نرم و سخت برای مشتری
- حل Exact برای مسائل کوچک و حالت Bounded با **Incumbent + Lower Bound + Optimality Gap**
- حل ابتکاری مبتنی بر درج شدنی و بهبود محلی برای مسائل بزرگ‌تر یا محدودیت‌های عملیاتی پیچیده
- داشبورد KPI شامل تعداد خودروهای استفاده‌شده، بهره‌برداری ظرفیت، مسافت، زمان، هزینه، زمان Solver و Gap
- مقایسه چهار سناریو: Distance، Base Time، Moderate Synthetic Traffic، Heavy Synthetic Traffic
- Import/Export JSON
- Import گروهی **CSV و XLSX** با گزارش اعتبارسنجی قبل از اعمال
- قالب CSV آماده برای depot / customer / vehicle
- رابط RTL با Vazirmatn، SEO/GEO، Structured Data و هدرهای امنیتی Vercel

## تابع هدف هزینه

برای وسیله نقلیه `v`، هزینه یک مسیر به‌صورت مفهومی برابر است با:

```text
RouteCost(v) = FixedDispatchCost(v)
             + Distance(km) × CostPerKm(v)
             + TravelTime(min) × CostPerMinute(v)
```

بنابراین جواب کم‌هزینه لزوماً کوتاه‌ترین جواب نیست. Solver می‌تواند مثلاً با اعزام یک خودروی بزرگ‌تر و حذف هزینه ثابت خودروی دوم، مسافت بیشتری را بپذیرد ولی هزینه کل کمتری ایجاد کند.

اگر سناریوی ترافیک مصنوعی برای تابع هدف Cost انتخاب شده باشد، جزء `TravelTime` از همان ماتریس زمان سناریویی استفاده می‌کند. این سناریو داده زنده یا تاریخی نیست.

## محدودیت‌های اختیاری خودرو

هر خودرو می‌تواند داشته باشد:

- `maxDistanceKm`
- `maxDurationMin`
- `maxStops`
- `returnToDepot`

`maxStops` و `returnToDepot` در حل Exact کوچک پشتیبانی می‌شوند. در حضور `maxDistanceKm` یا `maxDurationMin`، نسخه 2.2 برای جلوگیری از ادعای نادرست بهینگی، **گواهی Exact صادر نمی‌کند** و از حل محدودیت‌پذیر ابتکاری/کراندار استفاده می‌کند.

## اولویت مشتری

دو سیاست وجود دارد:

- **Soft:** تابع هدف اصلی تغییر نمی‌کند؛ اولویت در روش ابتکاری برای ترجیح درج و سرویس زودتر به‌عنوان معیار ثانویه استفاده می‌شود.
- **Hard:** داخل هر مسیر، مشتری با اولویت بالاتر نمی‌تواند بعد از مشتری کم‌اولویت‌تر قرار بگیرد. همه مشتری‌ها همچنان باید سرویس بگیرند.

اولویت در این نسخه به معنی حذف مشتری کم‌اولویت نیست.

## Exact، Bounded و Gap

Solver دقیق فعلی یک الگوریتم داخلی مبتنی بر Dynamic Programming روی زیرمجموعه‌ها و تخصیص ناوگان ناهمگن است. برای مسائل کوچک، اگر جست‌وجو کامل شود، نتیجه نسبت به مدل و ماتریس هزینه ورودی **Optimal** است.

حالت Bounded ابتدا یک جواب شدنی (Incumbent) تولید می‌کند و یک **Lower Bound معتبر** محاسبه می‌کند. سپس اگر ابعاد و محدودیت‌ها اجازه دهند، حل دقیق را تا سقف زمانی ادامه می‌دهد. اگر حل کامل شود `Gap = 0%` است؛ در غیر این صورت Gap گزارش می‌شود.

> این نسخه عمداً HiGHS را به‌صورت CDN runtime وارد نکرده است تا سطح وابستگی و حمله supply-chain پروژه افزایش پیدا نکند. Gap و گواهی فعلی توسط Solver داخلی اپتی‌مسیر تولید می‌شوند. اگر در آینده HiGHS به‌صورت vendored و hash-verified داخل repository قرار گیرد، می‌توان یک MILP عمومی‌تر برای محدودیت‌های عملیاتی پیچیده اضافه کرد.

Lower Bound فعلی محافظه‌کارانه است و ممکن است نسبتاً ضعیف باشد؛ بنابراین Gap مثبت لزوماً به معنی بد بودن جواب نیست، بلکه فاصله اثبات‌شده بین بهترین جواب موجود و کران پایین است.

## Import CSV / Excel

یک فایل می‌تواند سه نوع ردیف داشته باشد. ستون `kind` یکی از این مقادیر است:

- `depot`
- `customer`
- `vehicle`

ستون‌های پشتیبانی‌شده:

```text
kind,name,latitude,longitude,demand,priority,vehicle_type,capacity,
fixed_cost,cost_per_km,cost_per_min,max_distance_km,max_duration_min,
max_stops,return_to_depot,enabled,unit
```

برای XLSX، Sheet اول با همین headerها خوانده می‌شود. فایل ابتدا اعتبارسنجی می‌شود؛ سپس کاربر می‌تواند داده‌های معتبر را جایگزین داده فعلی یا به آن اضافه کند. ردیف‌های خطادار اعمال نمی‌شوند.

## مقایسه سناریوها

دکمه «مقایسه ۴ سناریو» یک ماتریس جاده‌ای مشترک می‌گیرد و چهار مسئله را با روش ابتکاری یکسان حل می‌کند:

1. Distance
2. Base Travel Time
3. Moderate Synthetic Traffic
4. Heavy Synthetic Traffic

این مقایسه برای تحلیل حساسیت و پژوهش مناسب است و به معنی مقایسه ترافیک واقعی نیست.

## مدل و محدودیت‌های علمی

- داده‌ها ایستا هستند؛ بازبهینه‌سازی حین عملیات انجام نمی‌شود.
- ترافیک واقعی، تاریخی و پیش‌بینی‌شده از OSRM دریافت نمی‌شود.
- Time Window و Service Time هنوز مدل نشده‌اند.
- ظرفیت یک‌بعدی است؛ وزن و حجم هم‌زمان پشتیبانی نمی‌شود.
- تقاضای هر مشتری غیرقابل‌تقسیم است.
- OSRM عمومی محدودیت تخصصی کامیون مانند ارتفاع، وزن محور و عرض را تضمین نمی‌کند.
- «مسیر واقعی روی خیابان» به معنی «مدل کامل دنیای واقعی» نیست.
- اگر OSRM در دسترس نباشد، fallback تقریبی Haversine × 1.25 استفاده می‌شود و UI هشدار می‌دهد.
- سرویس‌های عمومی OSM/OSRM SLA تجاری ندارند.

## توسعه محلی

```bash
npm run dev
```

سپس `http://localhost:5173` را باز کنید.

## Build

```bash
npm run build
```

خروجی در `dist` ساخته می‌شود.

### Canonical و Sitemap

در Vercel متغیر محیطی زیر را روی دامنه نهایی تنظیم کنید:

```text
SITE_URL=https://your-domain.example
```

## Deploy روی Vercel

1. پروژه را در GitHub push کنید.
2. Repository را در Vercel Import کنید.
3. Framework Preset: `Other`
4. Build Command: `npm run build`
5. Output Directory: `dist`
6. `SITE_URL` را تنظیم کنید.
7. Deploy کنید.

## امنیت

پروژه backend و secret ندارد. XLSX بدون کتابخانه CDN جدید و در خود مرورگر خوانده می‌شود. هدرهای CSP، HSTS، nosniff، frame protection، Referrer Policy و Permissions Policy در `vercel.json` تنظیم شده‌اند. ورودی‌ها محدود و اعتبارسنجی می‌شوند و متن کاربر قبل از تزریق HTML escape می‌شود.

هیچ وب‌اپی را نمی‌توان صددرصد امن اعلام کرد؛ برای production جدی همچنان dependency review، تست امنیتی و مانیتورینگ لازم است.

## منابع علمی و فنی

- Dantzig, G. B., & Ramser, J. H. (1959). *The Truck Dispatching Problem*. Management Science, 6(1), 80–91. https://doi.org/10.1287/mnsc.6.1.80
- Clarke, G., & Wright, J. W. (1964). *Scheduling of Vehicles from a Central Depot to a Number of Delivery Points*. Operations Research, 12(4), 568–581. https://doi.org/10.1287/opre.12.4.568
- OSRM Documentation: https://project-osrm.org/docs/
- HiGHS project (future optional MILP backend): https://highs.dev/

## اعتبار

کاری از [حسین کریمی](https://www.linkedin.com/in/hossein-karimi-8a452153/)

## مجوز

MIT. مجوزهای OpenStreetMap، Leaflet و Vazirmatn مستقل هستند و attribution مربوطه باید حفظ شود.


## v2.2.1 map reliability hotfix

- Leaflet 1.9.4 is installed as an exact npm dependency and copied into `dist/vendor/leaflet` during build; the browser no longer depends on unpkg to initialize the map.
- Vazirmatn is also self-hosted from the pinned Fontsource npm package at build time.
- Added a UUID compatibility fallback for browsers/WebViews without `crypto.randomUUID()`; previously such a browser could fail before map initialization.
- Added explicit diagnostics for Leaflet load failure and OpenStreetMap tile load failure.
- Tightened CSP to self-hosted scripts/styles/fonts and corrected the JSON-LD CSP hash.

After replacing the repository files, trigger a fresh Vercel deployment so npm installs the pinned dependencies and `npm run build` vendors them into `dist`.
