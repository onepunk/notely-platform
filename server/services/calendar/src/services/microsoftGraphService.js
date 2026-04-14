/**
 * Microsoft Graph Service
 * Handles OAuth authentication and Microsoft Graph API calls for calendar data
 */

const { ConfidentialClientApplication } = require('@azure/msal-node');
const axios = require('axios');
const shared = require('@notely/shared');
const logger = shared.logger;

// Microsoft Graph API configuration
const GRAPH_API_BASE = 'https://graph.microsoft.com/v1.0';

// Calendar permission scopes
const CALENDAR_SCOPES = [
  'Calendars.Read',
  'Calendars.ReadBasic',
  'User.Read',
  'offline_access',
];

let msalClient = null;

/**
 * Initialize the MSAL client
 */
function initialize() {
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  const tenantId = process.env.MICROSOFT_TENANT_ID || 'common';

  if (!clientId || !clientSecret) {
    logger.warn('Microsoft OAuth credentials not configured');
    return;
  }

  const msalConfig = {
    auth: {
      clientId,
      clientSecret,
      authority: `https://login.microsoftonline.com/${tenantId}`,
    },
    system: {
      loggerOptions: {
        loggerCallback(level, message) {
          if (level <= 1) { // Error and Warning only
            logger.debug('MSAL:', { message });
          }
        },
        piiLoggingEnabled: false,
        logLevel: 1,
      },
    },
  };

  msalClient = new ConfidentialClientApplication(msalConfig);
  logger.info('Microsoft Graph service initialized', { clientId, tenantId });
}

/**
 * Get the authorization URL for OAuth flow
 */
function getAuthorizationUrl(redirectUri, state) {
  if (!msalClient) {
    throw new Error('Microsoft OAuth not configured');
  }

  const authCodeUrlParameters = {
    scopes: CALENDAR_SCOPES,
    redirectUri,
    state,
    prompt: 'consent', // Always show consent screen
  };

  return msalClient.getAuthCodeUrl(authCodeUrlParameters);
}

/**
 * Exchange authorization code for tokens
 * Uses direct OAuth call to ensure we get the refresh token
 */
async function exchangeCodeForTokens(code, redirectUri) {
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  const tenantId = process.env.MICROSOFT_TENANT_ID || 'common';

  if (!clientId || !clientSecret) {
    throw new Error('Microsoft OAuth not configured');
  }

  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;

  const params = new URLSearchParams();
  params.append('client_id', clientId);
  params.append('client_secret', clientSecret);
  params.append('code', code);
  params.append('redirect_uri', redirectUri);
  params.append('grant_type', 'authorization_code');
  params.append('scope', CALENDAR_SCOPES.join(' '));

  const response = await axios.post(tokenUrl, params, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  });

  const data = response.data;

  if (!data.refresh_token) {
    logger.warn('No refresh token received from Microsoft - offline_access scope may not be granted');
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || null,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
    idToken: data.id_token,
  };
}

/**
 * Refresh access token using refresh token
 */
async function refreshAccessToken(refreshToken) {
  if (!msalClient) {
    throw new Error('Microsoft OAuth not configured');
  }

  // MSAL doesn't directly support refresh tokens in the same way
  // We need to use the silent token acquisition or client credentials
  // For now, we'll use axios to call the token endpoint directly

  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  const tenantId = process.env.MICROSOFT_TENANT_ID || 'common';

  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;

  const params = new URLSearchParams();
  params.append('client_id', clientId);
  params.append('client_secret', clientSecret);
  params.append('refresh_token', refreshToken);
  params.append('grant_type', 'refresh_token');
  params.append('scope', CALENDAR_SCOPES.join(' '));

  const response = await axios.post(tokenUrl, params, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  });

  const data = response.data;

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken, // May return new refresh token
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
  };
}

/**
 * Get user profile from Microsoft Graph
 */
async function getUserProfile(accessToken) {
  const response = await axios.get(`${GRAPH_API_BASE}/me`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  return {
    id: response.data.id,
    email: response.data.mail || response.data.userPrincipalName,
    displayName: response.data.displayName,
  };
}

/**
 * Get calendar events from Microsoft Graph
 * Only fetches events from startDateTime forward (no past events)
 */
async function getCalendarEvents(accessToken, options = {}) {
  const {
    startDateTime = new Date().toISOString(),
    endDateTime = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // Default 7 days
    maxResults = 100,
    timezone = 'UTC',
  } = options;

  // Build query parameters
  const queryParams = new URLSearchParams({
    startDateTime,
    endDateTime,
    $top: maxResults.toString(),
    $select: 'id,subject,bodyPreview,start,end,location,isAllDay,isCancelled,organizer,onlineMeeting,webLink,lastModifiedDateTime',
    $orderby: 'start/dateTime',
  });

  const response = await axios.get(
    `${GRAPH_API_BASE}/me/calendarView?${queryParams.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Prefer: `outlook.timezone="${timezone}"`,
      },
    }
  );

  // Transform events to our format
  const events = response.data.value.map((event) => ({
    microsoftEventId: event.id,
    subject: event.subject || 'Untitled Event',
    bodyPreview: event.bodyPreview,
    location: event.location?.displayName || null,
    startTime: event.start.dateTime,
    endTime: event.end.dateTime,
    timezone: event.start.timeZone,
    isAllDay: event.isAllDay || false,
    isCancelled: event.isCancelled || false,
    organizerEmail: event.organizer?.emailAddress?.address,
    organizerName: event.organizer?.emailAddress?.name,
    isOnlineMeeting: !!event.onlineMeeting,
    onlineMeetingUrl: event.onlineMeeting?.joinUrl || event.webLink,
    lastModifiedAt: event.lastModifiedDateTime,
    rawPayload: event,
  }));

  return {
    events,
    hasMore: !!response.data['@odata.nextLink'],
    nextLink: response.data['@odata.nextLink'],
  };
}

/**
 * Verify if a token is still valid by making a simple API call
 */
async function verifyToken(accessToken) {
  try {
    await axios.get(`${GRAPH_API_BASE}/me`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    return true;
  } catch (error) {
    if (error.response?.status === 401) {
      return false;
    }
    throw error;
  }
}

module.exports = {
  initialize,
  getAuthorizationUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
  getUserProfile,
  getCalendarEvents,
  verifyToken,
  CALENDAR_SCOPES,
};
