# Credential-less user recovery

The authentication migration intentionally leaves existing `pathpilot_users`
rows with `email` and `password_hash` set to `NULL`. Existing goals continue to
reference their original `pathpilot_users.id`; no goal is reassigned during
migration or registration.

## Required controlled procedure

Use this procedure only after verifying the person's identity and ownership of
the existing PathPilot account outside the application:

1. Identify the original `pathpilot_users.id` and list the goals whose
   `user_id` points to it.
2. Confirm the person is entitled to that exact user record. Do not match by
   display name alone; names are not unique proof of ownership.
3. Have an authorized operator attach the person's chosen, normalized email to
   that original user ID and store a newly generated password hash. Never store
   or write the plaintext password.
4. Confirm that the email is not already attached to another user. If it is,
   stop and resolve the identity conflict explicitly; do not merge or transfer
   goals automatically.
5. Verify sign-in and the expected goal list for that original user ID.
6. Record the approval and user-ID mapping in the operator's private recovery
   record. Do not put passwords, session tokens, or private identity evidence
   in this repository.

## Prohibited recovery shortcuts

- Do not create a new account and silently move old goals to it.
- Do not assign credentials to legacy users based only on `name`.
- Do not use a shared or temporary password.
- Do not expose password hashes or session tokens to the user or client.
- Do not run an automated data update as part of the authentication migration.

The application currently has no self-service legacy-account claim flow. Until
an approved operator workflow exists, credential-less legacy users remain
preserved but cannot sign in through the normal email/password endpoints.
