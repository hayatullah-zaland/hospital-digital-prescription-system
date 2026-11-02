# Hospital Digital Prescription Management System — Backend

The complete project requirements are preserved in
[docs/PROJECT_REQUIREMENTS.txt](docs/PROJECT_REQUIREMENTS.txt).
Future development follows this specification and [AGENTS.md](AGENTS.md).

د Backend معماري، collections، API لارې، اجازې او مرحله‌وار پلان په
[docs/BACKEND_PLAN.md](docs/BACKEND_PLAN.md) کې دي. لومړی ټول Backend او
ازموینې بشپړوو، وروسته Frontend. نوي فولډرونه نه جوړوو.

Patient registration, search, and record viewing are documented in
[PATIENT_API.md](PATIENT_API.md), including role permissions and Postman examples.

Doctor prescription creation and viewing are documented in
[PRESCRIPTION_API.md](PRESCRIPTION_API.md).

د ډاکټر profile، کاري وختونو او Postman بشپړ لارښود:
[docs/DOCTOR_API.md](docs/DOCTOR_API.md).

اوس authentication د **Bearer JWT** له لارې کار کوي.

```text
server.js → routes → middleware → controller → models
```

- `server.js`: Express او MongoDB اتصال.
- `models/User.js`: حساب، رول او bcrypt password hash.
- `middleware/authMiddleware.js`: JWT او د کارن اجازه چک کوي.
- `controller/authController.js`: signup، signin او خپل حساب.
- `models/Patient.js` او `controller/patientController.js`: د ناروغ ثبت، لټون، کتنه او سمون.
- `models/Prescription.js` او `controller/prescriptionController.js`: ساده نسخې جوړول او کتل.
- `models/Doctor.js` او `controller/doctorController.js`: د doctor حساب مسلکي profile، availability او فعال حالت.
- `middleware/doctorValidation.js`: د ډاکټر د معلوماتو validation په `validator` کوي؛
  د کوډ د لوستلو ساده پښتو لارښود په [DOCTOR_API.md](docs/DOCTOR_API.md) کې دی.

Logout/session revocation، audit logging، clinical safety checks، signing او
pharmacy processing لا د پورته پلان برخه دي؛ موجودې بشپړې برخې نه دي.

د backend دننه `npm run dev` وچلوئ. د لومړي مدیر لپاره `POST /api/auth/signup` ته `role: hospital_admin` ولېږئ.

د Doctor Management دایمي اتومات ازموینې په `npm test` چلېږي. `mongod`
باید په PATH کې وي، یا یې بشپړ path په `MONGOD_BINARY` کې وټاکئ. Test خپل
جلا موقتي DB کاروي. جزئیات په [Doctor API لارښود](docs/DOCTOR_API.md) کې دي.

| Method | API | اجازه |
| --- | --- | --- |
| POST | /api/auth/signup | عام ثبت، رول ټاکل کېدای شي |
| POST | /api/auth/signin | ننوتل |
| GET | /api/auth/me | JWT غواړي |
| POST | /api/auth/users | یوازې hospital_admin |

په Postman کې **Body → raw → JSON** وټاکئ. د ثبت غوښتنه name، email او password غواړي؛ login یوازې email او password غواړي. پاسورډ لږ تر لږه ۱۲ توري او تر ۷۲ UTF-8 bytes پورې وي.

```json
{
  "name": "Fictional Patient",
  "email": "patient@example.test",
  "password": "ExamplePassphrase123!"
}
```

د signin په ځواب کې `token` راځي. د `/api/auth/me`، `/api/auth/users` او نورو protected غوښتنو لپاره **Authorization → Bearer Token** وټاکئ او هماغه token پکې واچوئ:

```http
Authorization: Bearer YOUR_TOKEN
```

موجود JWT یو ساعت اعتبار لري. Logout، session revocation او refresh-token flow لا نه دي جوړ شوي؛ د Backend د امنیتي پړاو برخه دي.

مدیر د /api/auth/users له لارې name، email، password او role لېږي. رولونه hospital_admin، receptionist، doctor، hospital_pharmacist، external_pharmacist او patient دي. عام ثبت role مني؛ که role ونه لېږل شي، patient ټاکل کېږي.

JWT_SECRET شخصي وساتئ. موجودې protected غوښتنې token په Authorization header کې غواړي. د راتلونکي browser د CORS، cookies او session تګلاره په Backend پلان کې ده. د authentication کوډ لپاره لومړی `routes/authRoutes.js`، بیا `middleware/authMiddleware.js` او `controller/authController.js` ولولئ.
