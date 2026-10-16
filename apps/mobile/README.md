# Azim Command — تطبيق الموبايل

<div dir="rtl">

تطبيق مرافق (للقراءة غالباً) لبرنامج **Azim Command** على الكمبيوتر، لأجهزة iOS و Android. يعرض لوحات المؤشرات والتنبيهات والتذكيرات القادمة (ضرائب، أقساط، تجديد عقود) والموازنة مقابل الفعلي وقائمة المستندات والتقارير، ويستقبل الإشعارات. البيانات تأتي من **Inno Server** الذي يقوم برنامج الكمبيوتر بمزامنة بياناته معه.

من تطوير شركة Inno Source For Software Solutions.

## المتطلبات

- Node.js 20 أو أحدث
- تطبيق Expo Go على الموبايل (للتجربة السريعة) أو Development Build
- حساب Expo + أداة EAS CLI للبناء

## التشغيل أثناء التطوير

```bash
cd apps/mobile
npm install
npx expo start
```

امسح رمز QR بتطبيق Expo Go (أندرويد) أو بالكاميرا (iOS). للتأكد من الأنواع: `npx tsc --noEmit`.

## الإعداد داخل التطبيق

1. عند أول تشغيل أدخل **عنوان السيرفر** (الافتراضي `https://azim.0x01source.com:9990`) و**رمز الدخول**.
2. رمز الدخول يصدر من برنامج Azim Command على الكمبيوتر (إدارة المستخدمين) أو يكون أحد رموز المالك في `INNO_OWNER_TOKENS` على السيرفر.
3. التطبيق يتحقق من الرمز عبر `GET /api/azim-command/me` ثم يحفظ العنوان والرمز في الخزنة الآمنة للجهاز (expo-secure-store).
4. تسجيل الخروج وتغيير اللغة (العربية / English) من شاشة الإعدادات. الصلاحيات (الشركات المسموحة، إخفاء القرارات عن المحاسب) يطبّقها السيرفر.

## البناء بـ EAS

```bash
npm install -g eas-cli      # أو استخدم npx eas-cli@latest
eas login
eas init                    # يربط المشروع بحساب Expo ويكتب projectId في app.json
eas build -p android --profile preview      # ملف APK للتوزيع الداخلي
eas build -p android --profile production   # AAB لمتجر Google Play
eas build -p ios --profile production       # يحتاج حساب Apple Developer
eas submit -p android|ios                   # الرفع على المتاجر
```

ملفات البناء موجودة في `eas.json` (development / preview / production).

## الإشعارات (Push)

- الإشعارات تحتاج **EAS projectId**: شغّل `eas init` أو ضع القيمة يدوياً في `app.json` تحت `expo.extra.eas.projectId`.
- تعمل على جهاز حقيقي فقط، وفي Development Build أو نسخة EAS (وليس Expo Go على أندرويد).
- بعد تسجيل الدخول يطلب التطبيق الإذن ويرسل رمز Expo إلى `POST /api/azim-command/push/register`. السيرفر يرسل تذكيرات الاستحقاق تلقائياً.
- لأندرويد في الإنتاج: ارفع مفتاح FCM V1 من خلال `eas credentials`. لـ iOS: EAS ينشئ مفتاح APNs أثناء البناء.

## ملاحظات

- السيرفر الافتراضي يعمل بـ HTTP، لذلك تم السماح بالاتصال غير المشفّر (`usesCleartextTraffic` لأندرويد و `NSAllowsArbitraryLoads` لـ iOS). يُفضّل نقل السيرفر إلى HTTPS ثم إزالة هذه الإعدادات.
- الأيقونات وشاشة البداية في `assets/` هي الافتراضية من قالب Expo، استبدلها بشعار التطبيق.

</div>

---

# Azim Command — Mobile app (English)

A read-mostly companion to the **Azim Command** desktop app for iOS and Android: dashboards, alerts, upcoming reminders (tax, installments, contract renewals), budget vs actual, documents and reports, and push notifications. Data comes from **Inno Server**, which the desktop app syncs to.

Developed by Inno Source For Software Solutions.

## Stack

Expo SDK 57 (managed workflow), TypeScript, Expo Router (bottom tabs + stack, routes in `src/app/`), expo-secure-store, expo-notifications, react-native-svg (hand-rolled chart), expo-file-system + expo-sharing (open/share original documents). Arabic (default) and English with RTL, light/dark following the system.

```
src/
  app/                 routes: _layout (auth guard), login, (tabs)/{index,alerts,reminders,settings}, company/[id]
  components/          Txt, Layout (Screen/Card/Section/Button…), KpiCard, TrendChart, BudgetTable, Items, Icons
  api.ts               Inno Server client + row types
  session.tsx          session + language providers (secure storage)
  useData.ts           fetch hook with pull-to-refresh and per-key cache
  finance.ts           KPIs, consolidation, budget variance, reminder grouping
  format.ts            Intl number/date formatting (ar-EG / en-US)
  i18n.ts  theme.ts  push.ts  files.ts
```

## Run

```bash
cd apps/mobile
npm install
npx expo start
```

Type-check with `npx tsc --noEmit`.

## Configure the server

On first launch enter the **server URL** (default `https://azim.0x01source.com:9990`) and an **access token** (issued from the desktop app's user management, or one of the server's `INNO_OWNER_TOKENS`). The app validates it with `GET /api/azim-command/me` and stores both in the device keychain/keystore. Sign out and switch language in Settings. Permissions (allowed companies, hidden tables per role) are enforced by the server.

## Build with EAS

```bash
npx eas-cli@latest login
npx eas-cli@latest init                          # links the project, writes extra.eas.projectId
eas build -p android --profile preview           # internal APK
eas build -p android --profile production        # Play Store AAB
eas build -p ios --profile production            # needs an Apple Developer account
```

Profiles live in `eas.json` (development / preview / production).

## Push notifications

- Require an **EAS projectId** (`eas init`, or set `expo.extra.eas.projectId` in `app.json`).
- Physical device only, in a development or EAS build (not Expo Go on Android).
- After sign-in the app asks for permission and registers its Expo push token with `POST /api/azim-command/push/register`; the server pushes due reminders. Tapping a notification opens the Reminders tab.
- Android production needs FCM V1 credentials (`eas credentials`); iOS APNs keys are created by EAS during the build.

## Notes

- The default server is plain HTTP, so cleartext traffic is allowed (`expo-build-properties` → `android.usesCleartextTraffic`, iOS `NSAllowsArbitraryLoads`). Move the server to HTTPS and remove these when possible.
- Icons and splash in `assets/` are still the Expo template defaults; replace them with the app's branding.
