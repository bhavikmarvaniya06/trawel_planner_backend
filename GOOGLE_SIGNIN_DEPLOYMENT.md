# Google Sign-In backend deployment

The backend verifies Google ID tokens with `google-auth-library`. It requires the expected OAuth audience in `GOOGLE_CLIENT_ID`; if the variable is missing, `POST /api/auth/google` returns HTTP 503.

## Render

In the Render dashboard for `trawel_planner_backend`, add this environment variable:

| Name | Value |
| --- | --- |
| `GOOGLE_CLIENT_ID` | The same Google OAuth 2.0 **Web application Client ID** configured as frontend `REACT_APP_GOOGLE_CLIENT_ID` |

Save the setting and wait for Render to restart or redeploy the service. No Google Client Secret is required for verifying ID tokens.

The deployed API is `https://trawel-planner-backend.onrender.com/api`. The Express app currently permits cross-origin requests; the production login flow also depends on the frontend using the correct API base URL.

## Verify deployment

1. Confirm the frontend has `REACT_APP_GOOGLE_CLIENT_ID` and `REACT_APP_API_URL=https://trawel-planner-backend.onrender.com/api` in its Vercel Production environment, then rebuild/redeploy it.
2. Confirm `GOOGLE_CLIENT_ID` is set in Render and the service has restarted.
3. Open the production frontend login page. The Google button should render instead of the unconfigured message.
4. Complete a real Google login and confirm the browser's `POST /api/auth/google` request succeeds. An invalid-token probe is expected to return HTTP 401 when configured; HTTP 503 indicates the server still lacks its client ID.

Do not commit `.env` files, OAuth client secrets, or other credentials.
