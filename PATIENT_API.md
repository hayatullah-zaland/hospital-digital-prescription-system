# Patient registration and records

This module adds patient records to the existing Express and MongoDB backend.
A patient record stores registration details; it does not create a login account.

## Files to read

1. `models/Patient.js` defines the information saved in MongoDB.
2. `controller/patientController.js` checks input and creates, reads, or updates records.
3. `routes/patientRoutes.js` connects each endpoint to its controller and allowed roles.
4. `server.js` mounts the routes at `/api/patients`.

## Start with no users

If you deleted all users, create the first administrator before testing patient
registration. Start the backend with `npm run dev`, then send this request in
Postman with **Body > raw > JSON** and no authorization:

```http
POST http://localhost:5000/api/auth/signup
Content-Type: application/json
```

```json
{
  "name": "Test Administrator",
  "email": "admin@example.test",
  "password": "ExamplePassphrase123!",
  "role": "hospital_admin"
}
```

Replace the example credentials with your own. Expect **201 Created**, with
`user.role` equal to `hospital_admin`. Sign in with that email and password to
get the administrator's token. No setup script or `ADMIN_*` settings are needed.

Signup accepts `hospital_admin`, `receptionist`, `doctor`, `hospital_pharmacist`,
`external_pharmacist`, or `patient`. Omitting `role` defaults to `patient`;
an invalid role returns **400**. Anyone who can access signup can select an
administrator role with this configuration.

## Start and sign in

From the `backend` folder, run `npm run dev`. The existing `.env` needs
`MONGO_URI` and `JWT_SECRET` for the database and authentication.

In Postman, sign in with an existing staff account:

```http
POST http://localhost:5000/api/auth/signin
Content-Type: application/json
```

```json
{
  "email": "receptionist@example.test",
  "password": "ExamplePassphrase123!"
}
```

These are example credentials; use your own staff account, or the administrator
you just registered. Copy the returned `token`. For all patient requests, select
**Authorization > Bearer Token** and paste that token. Patient accounts cannot
access these staff endpoints. Staff accounts can be registered by selecting a
role at signup. An existing administrator can also create staff accounts through
`POST /api/auth/users`.

## Register a patient

Administrators and receptionists can register patients. In Postman, choose
**Body > raw > JSON**:

```http
POST http://localhost:5000/api/patients
Content-Type: application/json
```

```json
{
  "name": "Fictional Patient",
  "dateOfBirth": "1995-06-15",
  "gender": "male",
  "phone": "+93 700 000 000",
  "address": "Kabul"
}
```

`name`, `dateOfBirth`, and `phone` are required. The name must contain 2 to 100
characters. The date must be a real date in `YYYY-MM-DD` format and cannot be in
the future. Phone numbers accept 7 to 15 digits, an optional leading `+`, and
spaces, parentheses, or hyphens, with at most 25 characters in total.

`gender` is optional and accepts `male`, `female`, `other`, or `unspecified`
(the default). `address` is optional and can contain up to 300 characters.
The server records the staff member in `createdBy` and adds timestamps.

A successful request returns status **201** and `{ "message": "...", "patient": {...} }`.
Copy `patient._id` to use when viewing that record.

## List, search, and view

Administrators, receptionists, and doctors can use these endpoints:

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/patients` | List the newest patients first |
| GET | `/api/patients?search=Fictional` | Search names or phone numbers |
| GET | `/api/patients?page=2&limit=10` | Read the next page |
| GET | `/api/patients/PATIENT_ID` | View one patient using its `_id` |

Use `http://localhost:5000` before each endpoint. Search is case-insensitive and
treats special characters as ordinary text. Search and pagination can be used
together. Pages start at 1; the default page size is 10 and the maximum is 50.
Lists return `patients` plus `pagination` with `page`, `limit`, `total`, and
`totalPages`. A single-record request returns `{ "patient": {...} }`.

Missing or invalid authentication returns **401**; a disallowed role returns
**403**. Invalid input or a malformed ID returns **400**. A valid ID with no
matching record returns **404**. Patient responses include `Cache-Control: no-store`.

## Update a patient

Administrators and receptionists can edit a patient. Use the same Bearer token
and replace `PATIENT_ID` with the `_id` from registration or a GET response.
In Postman, choose **Body > raw > JSON**:

```http
PATCH http://localhost:5000/api/patients/PATIENT_ID
Content-Type: application/json
```

```json
{
  "phone": "+93 711 000 000",
  "address": "Herat"
}
```

Only send the fields you want to change: `name`, `dateOfBirth`, `gender`, `phone`,
or `address`. The registration validation rules also apply to edits. Other
patient details keep their existing values. Send `"address": ""` to clear an
address. An empty body or any field outside this list returns **400**.

Expect **200 OK** with `message: "Patient updated successfully"` and the updated
`patient`. Confirm the saved changes with `GET /api/patients/PATIENT_ID`.
The patient's `_id`, `createdBy`, and `createdAt` cannot be changed through this
endpoint; `updatedAt` is refreshed when details change.

To check validation, send `"phone": "abc"` or `"dateOfBirth": "2025-02-30"` and
expect **400**. A doctor's or patient's token returns **403** for updates, and a
request without a token returns **401**. A valid patient ID with no matching
record returns **404**.
