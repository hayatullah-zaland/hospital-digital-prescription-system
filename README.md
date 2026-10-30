# ساده JWT Authentication

اوس authentication د **Bearer JWT** له لارې کار کوي.

```text
server.js → routes → middleware → controller → models
```

- `server.js`: Express او MongoDB اتصال.
- `models/User.js`: حساب، رول او bcrypt password hash.
- `middleware/auth.js`: JWT او د کارن اجازه چک کوي.
- `controller/authController.js`: register، login، logout او خپل حساب.
- `models/AuditLog.js`: مهم فعالیتونه ثبتوي.
- `middleware/validate.js` او `errorHandler.js`: معلومات او خطاګانې اداره کوي.

د backend دننه `npm run dev` وچلوئ. د لومړي مدیر لپاره `npm run create-admin` لا هم کار کوي.

| Method | API | اجازه |
| --- | --- | --- |
| POST | /api/auth/register | عام ثبت، یوازې patient |
| POST | /api/auth/login | ننوتل |
| GET | /api/auth/me | JWT غواړي |
| POST | /api/auth/logout | JWT غواړي |
| POST | /api/users | یوازې hospital_admin |

په Postman کې **Body → raw → JSON** وټاکئ. د ثبت غوښتنه name، email او password غواړي؛ login یوازې email او password غواړي. پاسورډ لږ تر لږه ۱۲ توري او تر ۷۲ UTF-8 bytes پورې وي.

```json
{
  "name": "Fictional Patient",
  "email": "patient@example.test",
  "password": "ExamplePassphrase123!"
}
```

د ثبت یا login ځواب کې `token` راځي. د /me، /logout او /api/users لپاره **Authorization → Bearer Token** وټاکئ او هماغه token پکې واچوئ:

```http
Authorization: Bearer YOUR_TOKEN
```

JWT په عادي حالت کې یو ساعت اعتبار لري؛ JWT_EXPIRES_IN یې تنظیموي. Logout د User په ریکارډ کې tokenVersion زیاتوي، نو د همدغه حساب **ټول پخواني tokenونه** لغوه کېږي. د logout وروسته په client/Postman کې هم پخوانی token لرې کړئ؛ د بیا کارولو لپاره login وکړئ. د پخوانۍ cookie طریقې کاروونکي هم باید بیا login وکړي. د Session جلا ماډل او د cookies authentication لرې شوي دي.

مدیر د /api/users له لارې name، email، password او role لېږي. رولونه hospital_admin، receptionist، doctor، hospital_pharmacist، external_pharmacist او patient دي. عام ثبت role نه مني؛ بند یا حذف شوی کارن هم اجازه نه لري.

JWT_SECRET شخصي وساتئ، لږ تر لږه ۳۲ تصادفي توري ورکړئ، او production کې HTTPS وکاروئ. راتلونکی frontend باید token په Authorization header کې ولېږي؛ withCredentials ته اړتیا نشته. د frontend لپاره CLIENT_ORIGIN تنظیم کړئ. د ننوتلو rate limit، د معلوماتو چک او د پاسورډ hash لا هم فعال دي. د کوډ د کتلو لپاره لومړی routes/authRoutes.js، بیا middleware/auth.js او controller/authController.js ولولئ.
