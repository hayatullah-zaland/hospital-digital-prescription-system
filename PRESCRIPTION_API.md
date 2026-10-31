# Doctor prescriptions

Doctors can create prescriptions for registered patient records. The server
links each prescription to the patient and the signed-in doctor. Doctors can
read their own prescriptions; administrators can read all prescriptions.

## Files to read

1. `models/Prescription.js` defines the prescription and medicine fields.
2. `controller/prescriptionController.js` validates input and saves or reads records.
3. `routes/prescriptionRoutes.js` applies authentication and role permissions.
4. `server.js` mounts the routes at `/api/prescriptions`.

## Register and sign in as a doctor

Start the backend with `npm run dev`. In Postman, send this request with
**Body > raw > JSON**:

```http
POST http://localhost:5000/api/auth/signup
Content-Type: application/json
```

```json
{
  "name": "Test Doctor",
  "email": "doctor@example.test",
  "password": "ExamplePassphrase123!",
  "role": "doctor"
}
```

If you already have a doctor account, use it. Sign in with that account:

```http
POST http://localhost:5000/api/auth/signin
Content-Type: application/json
```

```json
{
  "email": "doctor@example.test",
  "password": "ExamplePassphrase123!"
}
```

Copy the returned token. For prescription requests, select
**Authorization > Bearer Token** and paste the doctor's token.

## Create a prescription

Use the `_id` of an existing patient record. Doctors can find patients with
`GET /api/patients?search=Khan`; administrators and receptionists register the
patients. A patient login account's ID is different from a patient record's ID.

```http
POST http://localhost:5000/api/prescriptions
Content-Type: application/json
```

```json
{
  "patientId": "REPLACE_WITH_PATIENT_RECORD_ID",
  "diagnosis": "Fictional diagnosis for API testing",
  "medicines": [
    {
      "name": "Demo medicine",
      "dosage": "Demo dosage",
      "frequency": "Demo frequency",
      "duration": "Demo duration",
      "instructions": "Demo instructions"
    }
  ],
  "notes": "Fictional prescription for API testing"
}
```

This example uses placeholder medicine details. Expect **201 Created** with
`message: "Prescription created successfully"` and a `prescription` object.
Copy `prescription._id` to read it back. The record is saved in MongoDB's
`prescriptions` collection. Its `doctor` is always taken from the signed-in
account; sending a different doctor ID does not change the author.

Validation uses `validator` for text and IDs. `patientId`, `diagnosis`, and
`medicines` are required. A diagnosis must contain 2 to 500 characters after
trimming. Include 1 to 20 medicine objects. Each medicine requires a `name` of
2 to 100 characters and `dosage`, `frequency`, and `duration` of 1 to 100
characters each. `instructions` is optional with at most 300 characters.
`notes` is optional with at most 1000 characters. Optional text defaults to an
empty string. All text is trimmed before saving.

## List and view prescriptions

Use the doctor's token or an administrator's token:

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/prescriptions` | List prescriptions, newest first |
| GET | `/api/prescriptions?patientId=PATIENT_ID` | Filter by patient record |
| GET | `/api/prescriptions?page=1&limit=5` | Paginate the list |
| GET | `/api/prescriptions/PRESCRIPTION_ID` | View one prescription |

Use `http://localhost:5000` before each endpoint and replace the ID placeholders.
The default page size is 10 and the maximum is 50. Filtering and pagination can
be combined. Lists return `prescriptions` and `pagination` with `page`, `limit`,
`total`, and `totalPages`. A single-record request returns `prescription`.
GET responses include the patient's name, date of birth, and gender and the
doctor's name. Doctor account passwords and emails are not included.

A doctor's list and counts include only prescriptions written by that doctor,
including when filtering by patient. Reading another doctor's prescription by
ID returns **404**. Administrators can view all prescriptions but cannot create
them. Receptionists, pharmacists, and patient accounts cannot access this
module's endpoints in this version.

## Checks in Postman

- A valid doctor's request returns **201**; GET returns **200**.
- Missing or invalid authentication returns **401**.
- Creating with an administrator's or patient's token returns **403**.
- An invalid patient ID, empty medicine list, or missing medicine field returns **400**.
- Creating for a valid patient ID with no matching patient returns **404**.
- A malformed prescription ID returns **400**; an unknown ID returns **404**.

Responses include `Cache-Control: no-store`.
