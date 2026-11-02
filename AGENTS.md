# Hospital Digital Prescription Management System

## Requirements reference

Read `docs/PROJECT_REQUIREMENTS.txt` before planning or implementing features.
It preserves the complete requirements provided by the user on 2026-11-02.
Follow the requirements together with the user's latest explicit instructions.
Describe gaps between existing code and the requirements; existing behavior is
not proof that a requirement has been completed.
Use `docs/BACKEND_PLAN.md` for the backend architecture and phased implementation
order. Keep its descriptions of existing and planned functionality accurate.

## Working style

- Do not create new folders. Add files only within the existing `models`,
  `controller`, `routes`, `middleware`, and `docs` directories, or the existing
  backend root when appropriate. Keep the singular `controller` directory.
  Do not add `services`, `config`, `validators`, `scripts`, or `tests` folders.
  Place future test files beside the relevant code in the existing directories.
- Complete and test all required backend modules before starting frontend
  implementation, as requested on 2026-11-02. Cover the backend APIs for every
  required module, including the patient portal, dashboards, notifications,
  reports, and settings. Frontend planning can inform API design, but React
  implementation comes after the backend phases.
- Explain decisions, implementation steps, and completed work in clean, simple Pashto.
- Keep code understandable at an intermediate level, reusable, and maintainable.
- Prefer direct field assignments, ordinary `if` statements and `for...of` loops.
  Avoid unnecessary generic helpers, dynamic object copying, and dense chains
  of callbacks. Add short Pashto comments that explain the main steps. Keep
  input validation in a clear, small function or middleware within existing
  directories, and explain the request flow when separating it from a controller.
- Develop in manageable phases. Before application code, explain the relevant
  architecture, database relationships, folder structure, API endpoints, role
  permissions, and place in the development roadmap. Establish the complete
  project design before expanding into additional modules.
- Preserve existing work and test the functionality after each phase. Report
  what was completed, what was tested, and any remaining limitations accurately.
- Use `validator` for backend input validation, as requested in this conversation.
  The specified frontend form stack is React Hook Form with Zod.

## Stack and interface

- Follow the MERN stack and the specific libraries listed in the requirements.
- Use React with Vite, JavaScript, plain CSS and CSS variables. Do not use DaisyUI.
- Build responsive, accessible interfaces with light/dark modes and persistent themes.
- Use Indigo `#4f46e5` as the primary color and Emerald `#10b981` as the secondary color.

## Primary objectives

Prioritize all five objectives: structured digital prescriptions, drug-interaction
detection, patient medical/prescription history, signed prescription transmission
to authorized pharmacies, and medication allergy/sensitivity alerts. Track partial
features as partial; basic prescription CRUD alone does not fulfill all five.

## Authorization and clinical data

- Enforce permissions on the server by role and relationship to the patient or
  pharmacy. Keep personal medical information protected.
- Use password hashing, secure authentication/session handling, audit trails,
  traceable approval, and protection against unauthorized prescription changes.
- Signed prescriptions must not be silently modified or deleted. Corrections
  and cancellations must remain traceable.
- Drug-interaction and allergy checking require a reliable, validated medication
  knowledge source. Academic synthetic data must be explicitly labeled simulated
  and unsuitable for actual patient care. Do not present a demonstration rule
  set as validated clinical checking.
- Use safe, fictional test data for development and demonstrations.
