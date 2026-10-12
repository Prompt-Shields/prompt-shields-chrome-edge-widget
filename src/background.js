// eslint-disable-next-line no-undef
importScripts('config/config.js');

// Atlas policy-bundle + telemetry runs in the service-worker context (ported from
// Safari). It is self-contained: registers its own onInstalled/onStartup/onMessage
// listeners and reads its config from chrome.storage.local (keys `atlas.*`).
// eslint-disable-next-line no-undef
importScripts('lib/atlas-bundle.js');

// Config is loaded from config/config.js via importScripts
// The config file contains only the environment-specific configuration
 
if (typeof Config === 'undefined') {
  throw new Error('Config failed to load - config/config.js must be present and valid');
}
import { MessageTypes } from './config/messageTypes.js';
import { browserCompat } from './utils/browserCompatibility.js';
import { generateNonce } from './utils/authUtils.js';
import {
  initializeAnalytics,
  setAnalyticsUser,
  resetAnalyticsUser,
  trackAuthEvents,
  trackExtensionEvents,
} from './analytics/analyticsInit.js';

// Get Auth0 configuration from unified config system
// Note: Config is available as global from importScripts
let authConfig, AUTH0_DOMAIN, CLIENT_ID, AUDIENCE, tokenUrl, jwksUrl, serviceConfig;

// Initialize auth config from unified configuration system
function initializeAuthConfig() {
  console.log('Background: Checking Config availability:', typeof Config);
   
  if (typeof Config === 'undefined') {
    throw new Error('Config is not defined - config.js may not have loaded properly');
  }

  // eslint-disable-next-line no-undef
  console.log('Background: getAuth0 method exists:', typeof Config.getAuth0);

  // eslint-disable-next-line no-undef
  serviceConfig = new Config();
  authConfig = serviceConfig.getAuth0();
  AUTH0_DOMAIN = authConfig.domain;
  CLIENT_ID = authConfig.clientId;
  AUDIENCE = authConfig.audience;
  tokenUrl = authConfig.tokenUrl;
  jwksUrl = authConfig.jwksUrl;

  console.log('Auth0 configuration loaded successfully:', {
    domain: AUTH0_DOMAIN,
    clientId: CLIENT_ID,
    audience: AUDIENCE
  });
  return true;
}

// Initialize Auth0 configuration
console.log('Starting Auth0 config initialization...');
initializeAuthConfig();

// Initialize Analytics
console.log('Initializing analytics...');
initializeAnalytics().then(() => {
  console.log('Analytics initialized successfully');
}).catch(error => {
  console.error('Failed to initialize analytics:', error);
});

// Seed dormant Atlas config so atlas-bundle/violation-reporter read defined values.
// Reporting stays OFF while endpoint/apiKey are empty (see content-prescan.js).
// Real values are supplied later via setAtlasConfig — see docs/CHAT_AND_ATLAS_SETUP.md.
// Guarded so it never overwrites values an admin has already set.
chrome.storage.local.get('atlas.endpoint', (r) => {
  if (r['atlas.endpoint'] === undefined) {
    chrome.storage.local.set({
      'atlas.endpoint': '',
      'atlas.apiKey': '',
      'atlas.violationsUrl': '',
      'atlas.telemetryUrl': '',
      'atlas.enforcementMode': 'guideline',
      'atlas.appealUrl': '',
    });
  }
});

// Listen for extension install/update events
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    trackExtensionEvents.installed();
    console.log('Extension installed - tracked');
  } else if (details.reason === 'update') {
    trackExtensionEvents.installed(details.previousVersion);
    console.log(`Extension updated from ${details.previousVersion} - tracked`);
  }
});

/**
 * Get specific API URL from unified config system
 * @param {string} endpoint - Endpoint name
 * @returns {string} API URL
 */
function getApiUrl(endpoint) {
   
  return serviceConfig.getApiUrl(endpoint);
}

/**
 * Build API URL from template with parameters
 * @param {string} endpoint - Endpoint name (template)
 * @param {Object} params - Parameters to substitute
 * @returns {string} Built URL
 */
// eslint-disable-next-line no-unused-vars
function buildApiUrl(endpoint, params = {}) {
  // eslint-disable-next-line no-undef
  return Config.buildApiUrl(endpoint, params);
}

// Log browser compatibility info on startup
browserCompat.logDebugInfo();

// Import CommunicationService for future use
// Note: This is a placeholder for when we fully migrate to CommunicationService
// For now, we keep the existing chrome.runtime implementation for stability

// Listeners
// eslint-disable-next-line no-unused-vars
let popupPort;
function connectPort() {
  popupPort = browserCompat.connectPort({ name: 'comms' });
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    const allowedDomains = [
      'openai.com',
      'huggingface.co',
      'runwayml.com',
      'deepmind.com',
      'anthropic.com',
      'cohere.ai',
      'stability.ai',
      'perplexity.ai',
      'copy.ai',
      'jasper.ai',
      'midjourney.com',
      'scribehow.com',
      'writesonic.com',
      'speechmatics.com',
      'gradio.app',
      'notion.so',
      'fathom.video',
      'gptzero.me',
      'fireflies.ai',
      'fireflies.ai',
      'deepseek.com',
      'chatgpt.com',
      'poe.com',
      'synthesia.io',
      'elevenlabs.io',
      'replika.ai',
      'murf.ai',
      'grammarly.com'
    ];

    // Check if the current tab's domain matches allowed domains
    const isAllowed = allowedDomains.some(domain => tab.url.includes(domain));

    // Enable or disable the action based on the domain
    if (isAllowed) {
      chrome.action.enable(tabId);
    } else {
      chrome.action.disable(tabId);
    }
  }
});
chrome.runtime.onConnect.addListener((port) => {
  // In-page AI chat (ported from Safari). chat-client.js opens a 'chat-stream' Port
  // and posts CHAT_REQUEST; we proxy to the chat endpoint with the Auth0 access token
  // and stream the SSE body back as { sse } / { closed } / { error } messages.
  if (port.name === 'chat-stream') {
    let abortController = null;
    port.onDisconnect.addListener(() => {
      if (abortController) abortController.abort();
    });
    port.onMessage.addListener(async (message) => {
      if (!message || message.type !== 'CHAT_REQUEST') return;
      if (!message.payload) { port.postMessage({ error: 'Missing payload' }); return; }
      try {
        const credentials = await getCredentials();
        const token = credentials && credentials.accessToken;
        if (!token) { port.postMessage({ error: 'Not authenticated' }); return; }

        abortController = new AbortController();
        const resp = await fetch(getApiUrl('chat'), {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Accept': 'text/event-stream',
          },
          body: JSON.stringify(message.payload),
          signal: abortController.signal,
        });

        if (!resp.ok || !resp.body) {
          port.postMessage({ error: `Chat request failed (${resp.status})` });
          return;
        }

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          port.postMessage({ sse: decoder.decode(value, { stream: true }) });
        }
        const tail = decoder.decode();
        if (tail) port.postMessage({ sse: tail });
        port.postMessage({ closed: true });
      } catch (e) {
        if (e && e.name === 'AbortError') return;
        try { port.postMessage({ error: e && e.message ? e.message : 'Chat stream error' }); } catch (_) { /* port already closed */ }
      }
    });
    return; // chat-stream handled; don't attach the auth message handler below
  }

  port.onMessage.addListener(async (message) => {
    if (message.type === MessageTypes.AUTHORIZE) {
      authorize().then(userData => {
        console.log('authorize ');
        port.postMessage({ status: MessageTypes.AUTHORIZE, userData, success: true });
        sendAuthUpdate(true);
      }).catch((error) => {
        port.postMessage({ status: MessageTypes.AUTHORIZE, success: false, error: error.message });
        sendAuthUpdate(false);
      });
      return true;
    } else if (message.type === MessageTypes.LOGOUT) {
      // Clear credentials from memory immediately
      await removeCredentials();
      console.log('User logged out - credentials cleared from memory');
      port.postMessage({ status: MessageTypes.LOGOUT, success: true });
      sendAuthUpdate(false);
      return true;
    } else if (message.type === MessageTypes.PING) {
      try {
        const credentials = await getCredentials();
        if (credentials != null) {
          // Try to decode the ID token to get user data
          try {
            // Decode the stored ID token to get actual user data
            const decodedIdToken = await decodeJWT(credentials.idToken);
            const jwtPayload = decodedIdToken.payload;

            const userData = {
              first_name: jwtPayload['given_name'] || jwtPayload['name'] || 'User',
              email: jwtPayload['email'] || 'user@example.com',
              photo_url: jwtPayload['picture'] || '',
            };

            if (userData) {
              const responseData = {
                first_name: userData['first_name'],
                email: userData['email'],
                photo_url: userData['photo_url'],
              };
              port.postMessage({ status: MessageTypes.GET_USER, success: true, userData: responseData });
              sendAuthUpdate(true);
            } else {
              // User data is null/undefined, treat as not authenticated
              port.postMessage({ status: MessageTypes.GET_USER, success: true, userData: null });
              sendAuthUpdate(true);
            }
          } catch (error) {
            console.warn('Failed to get user data from credentials:', error);
            // If we can't get user data, still consider authenticated if credentials exist
            port.postMessage({ status: MessageTypes.GET_USER, success: true, userData: null });
            sendAuthUpdate(true);
          }
        } else {
          // No credentials found, user is not authenticated
          port.postMessage({ status: MessageTypes.GET_USER, success: false });
          sendAuthUpdate(false);
        }
      } catch (error) {
        console.error('Error checking credentials:', error);
        // If there's an error getting credentials, treat as not authenticated
        port.postMessage({ status: MessageTypes.GET_USER, success: false });
        sendAuthUpdate(false);
      }
      return true;
    } else if (message.type === MessageTypes.GET_CREDENTIALS) {
      try {
        const credentials = await getCredentials();
        console.log('Background: GET_CREDENTIALS request, returning:', credentials ? 'credentials present' : 'null');
        port.postMessage({ credentials });
      } catch (error) {
        console.error('Error getting credentials:', error);
        port.postMessage({ credentials: null });
      }
      return true;
    } else if (message.type === MessageTypes.GET_PROFILE) {
      try {
        // First check if we have profile data in memory
        let profile = await getProfile();

        if (!profile) {
          // If no profile in memory, fetch it from the API
          console.log('No profile in memory, fetching from API...');
          profile = await fetchProfile();
        }

        if (profile) {
          console.log('Background: GET_PROFILE request, returning profile data');
          port.postMessage({ status: MessageTypes.GET_PROFILE, success: true, profile });
        } else {
          console.log('Background: GET_PROFILE request, no profile available');
          port.postMessage({ status: MessageTypes.GET_PROFILE, success: false, error: 'Profile not available' });
        }
      } catch (error) {
        console.error('Error handling GET_PROFILE request:', error);
        port.postMessage({ status: MessageTypes.GET_PROFILE, success: false, error: error.message });
      }
      return true;
    }
  });
});
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === MessageTypes.CONTENT_AUTH_UPDATE) {
    getCredentials().then(credentials => {
      sendResponse({ isAuthenticated: credentials != null });
    });
    return true;
  } else if (message.type === MessageTypes.GET_CREDENTIALS) {
    getCredentials().then(credentials => {
      console.log('Background: GET_CREDENTIALS request (runtime), returning:', credentials ? 'credentials present' : 'null');
      sendResponse({ credentials });
    }).catch(error => {
      console.error('Error getting credentials (runtime):', error);
      sendResponse({ credentials: null });
    });
    return true;
  } else if (message.type === MessageTypes.GET_PROFILE) {
    (async () => {
      try {
        // First check if we have profile data in memory
        let profile = await getProfile();

        if (!profile) {
          // If no profile in memory, fetch it from the API
          console.log('No profile in memory, fetching from API...');
          profile = await fetchProfile();
        }

        if (profile) {
          console.log('Background: GET_PROFILE request (runtime), returning profile data');
          sendResponse({ success: true, profile });
        } else {
          console.log('Background: GET_PROFILE request (runtime), no profile available');
          sendResponse({ success: false, error: 'Profile not available' });
        }
      } catch (error) {
        console.error('Error handling GET_PROFILE request (runtime):', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  } else if (message.type === MessageTypes.DECODE_TOKEN) {
    sendResponse({ error: 'Unknown action' });
    sendAuthUpdate(false);
  } else if (message.type === MessageTypes.UPLOAD_PHOTO) {
    // Handle photo upload - this would be implemented with actual API endpoints
    sendResponse({ success: false, error: 'Photo upload not yet implemented' });
  } else if (message.type === MessageTypes.DELETE_PHOTO) {
    // Handle photo deletion - this would be implemented with actual API endpoints
    sendResponse({ success: false, error: 'Photo deletion not yet implemented' });
  } else if (message.type === MessageTypes.GET_SUGGESTIONS_HISTORY) {
    // Handle history requests - this would be implemented with actual API endpoints
    sendResponse({ success: false, error: 'History API not yet implemented' });
  } else if (message.type === MessageTypes.FETCH_SUGGESTION_TYPES) {
    handleFetchSuggestionTypes(sendResponse);
    return true;
  } else if (message.type === MessageTypes.LIST_SUGGESTION_TYPES) {
    handleListSuggestionTypes(message.enabledOnly, sendResponse);
    return true;
  } else if (message.type === MessageTypes.CREATE_SUGGESTION_TYPE) {
    handleCreateSuggestionType(message.suggestionType, sendResponse);
    return true;
  } else if (message.type === MessageTypes.UPDATE_SUGGESTION_TYPE) {
    handleUpdateSuggestionType(message.suggestionType, sendResponse);
    return true;
  } else if (message.type === MessageTypes.DELETE_SUGGESTION_TYPE) {
    handleDeleteSuggestionType(message.suggestionType, sendResponse);
    return true;
  } else if (message.type === MessageTypes.TOGGLE_SUGGESTION_TYPE) {
    handleToggleSuggestionType(message.suggestionType, message.isEnabled, sendResponse);
    return true;
  } else if (message.type === MessageTypes.RESET_SUGGESTION_TYPES) {
    handleResetSuggestionTypes(sendResponse);
    return true;
  }
});

// Suggestion Types Cache and Service
let suggestionTypesCache = [];
let suggestionTypesCacheTimestamp = null;
const SUGGESTION_TYPES_CACHE_TIMEOUT = 5 * 60 * 1000; // 5 minutes

function getSuggestionTypesBaseUrl() {
  // eslint-disable-next-line no-undef
  const config = serviceConfig || new Config();
  return config.getApiUrl('suggestionTypesBaseUrl');
}

async function handleFetchSuggestionTypes(sendResponse) {
  try {
    const credentials = await getCredentials();
    if (!credentials || !credentials.accessToken) {
      sendResponse({ success: false, error: 'User not authenticated' });
      return;
    }

    let profile = await getProfile();
    if (!profile) {
      profile = await fetchProfile();
    }
    if (!profile || !profile.default_suggestion_type_group_id) {
      sendResponse({ success: false, error: 'Profile or suggestion type group ID not available' });
      return;
    }

    const suggestionTypeGroupId = profile.default_suggestion_type_group_id;
    const baseUrl = getSuggestionTypesBaseUrl();
    const endpoint = `${baseUrl}/${suggestionTypeGroupId}?offset=0&limit=100`;

    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${credentials.accessToken}`,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      sendResponse({ success: false, error: `Failed to fetch: ${response.status}` });
      return;
    }

    const data = await response.json();
    const items = data.content.items || [];

    // Update cache
    suggestionTypesCache = items;
    suggestionTypesCacheTimestamp = Date.now();

    console.log(`Fetched ${items.length} suggestion types`);
    sendResponse({ success: true, suggestionTypes: items });
  } catch (error) {
    console.error('Error fetching suggestion types:', error);
    sendResponse({ success: false, error: error.message });
  }
}

async function handleListSuggestionTypes(enabledOnly, sendResponse) {
  try {
    // Check cache first
    if (suggestionTypesCacheTimestamp &&
      (Date.now() - suggestionTypesCacheTimestamp) < SUGGESTION_TYPES_CACHE_TIMEOUT &&
      suggestionTypesCache.length > 0) {
      let types = [...suggestionTypesCache];
      if (enabledOnly) {
        types = types.filter(t => t.is_enabled);
      }
      sendResponse({ success: true, suggestionTypes: types });
      return;
    }

    // Fetch from server if cache is invalid
    const credentials = await getCredentials();
    if (!credentials || !credentials.accessToken) {
      sendResponse({ success: false, error: 'User not authenticated' });
      return;
    }

    let profile = await getProfile();
    if (!profile) {
      profile = await fetchProfile();
    }
    if (!profile || !profile.default_suggestion_type_group_id) {
      sendResponse({ success: false, error: 'Profile not available' });
      return;
    }

    const suggestionTypeGroupId = profile.default_suggestion_type_group_id;
    const baseUrl = getSuggestionTypesBaseUrl();
    const endpoint = `${baseUrl}/${suggestionTypeGroupId}?offset=0&limit=100`;

    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${credentials.accessToken}`,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      sendResponse({ success: false, error: `Failed to fetch: ${response.status}` });
      return;
    }

    const data = await response.json();
    let items = data.content.items || [];

    // Update cache
    suggestionTypesCache = items;
    suggestionTypesCacheTimestamp = Date.now();

    if (enabledOnly) {
      items = items.filter(t => t.is_enabled);
    }

    sendResponse({ success: true, suggestionTypes: items });
  } catch (error) {
    console.error('Error listing suggestion types:', error);
    sendResponse({ success: false, error: error.message });
  }
}

async function handleCreateSuggestionType(suggestionType, sendResponse) {
  try {
    const credentials = await getCredentials();
    if (!credentials || !credentials.accessToken) {
      sendResponse({ success: false, error: 'User not authenticated' });
      return;
    }

    const baseUrl = getSuggestionTypesBaseUrl();

    const response = await fetch(`${baseUrl}/`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${credentials.accessToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(suggestionType)
    });

    if (!response.ok) {
      const errorText = await response.text();
      sendResponse({ success: false, error: `Failed to create: ${response.status} ${errorText}` });
      return;
    }

    const data = await response.json();

    // Update cache
    suggestionTypesCache.push(data);

    console.log('Created suggestion type:', data.id);
    sendResponse({ success: true, suggestionType: data });
  } catch (error) {
    console.error('Error creating suggestion type:', error);
    sendResponse({ success: false, error: error.message });
  }
}

async function handleUpdateSuggestionType(suggestionType, sendResponse) {
  try {
    const credentials = await getCredentials();
    if (!credentials || !credentials.accessToken) {
      sendResponse({ success: false, error: 'User not authenticated' });
      return;
    }

    let profile = await getProfile();
    if (!profile) {
      profile = await fetchProfile();
    }
    if (!profile || !profile.default_suggestion_type_group_id) {
      sendResponse({ success: false, error: 'Profile not available' });
      return;
    }

    const suggestionTypeGroupId = profile.default_suggestion_type_group_id;
    const baseUrl = getSuggestionTypesBaseUrl();
    const endpoint = `${baseUrl}/${suggestionTypeGroupId}/suggestion-type-id/${suggestionType.id}`;

    const response = await fetch(endpoint, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${credentials.accessToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        name: suggestionType.name,
        description: suggestionType.description,
        category: suggestionType.category,
        prompt_template: suggestionType.prompt_template,
        icon: suggestionType.icon,
        is_enabled: suggestionType.is_enabled,
        sort_order: suggestionType.sort_order
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      sendResponse({ success: false, error: `Failed to update: ${response.status} ${errorText}` });
      return;
    }

    const data = await response.json();

    // Update cache
    const index = suggestionTypesCache.findIndex(t => t.id === data.id);
    if (index >= 0) {
      suggestionTypesCache[index] = data;
    }

    console.log('Updated suggestion type:', data.id);
    sendResponse({ success: true, suggestionType: data });
  } catch (error) {
    console.error('Error updating suggestion type:', error);
    sendResponse({ success: false, error: error.message });
  }
}

async function handleDeleteSuggestionType(suggestionType, sendResponse) {
  try {
    const credentials = await getCredentials();
    if (!credentials || !credentials.accessToken) {
      sendResponse({ success: false, error: 'User not authenticated' });
      return;
    }

    let profile = await getProfile();
    if (!profile) {
      profile = await fetchProfile();
    }
    if (!profile || !profile.default_suggestion_type_group_id) {
      sendResponse({ success: false, error: 'Profile not available' });
      return;
    }

    const suggestionTypeGroupId = profile.default_suggestion_type_group_id;
    const baseUrl = getSuggestionTypesBaseUrl();
    const endpoint = `${baseUrl}/${suggestionTypeGroupId}/suggestion-type-id/${suggestionType.id}`;

    const response = await fetch(endpoint, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${credentials.accessToken}`,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      sendResponse({ success: false, error: `Failed to delete: ${response.status} ${errorText}` });
      return;
    }

    // Update cache
    suggestionTypesCache = suggestionTypesCache.filter(t => t.id !== suggestionType.id);

    console.log('Deleted suggestion type:', suggestionType.id);
    sendResponse({ success: true });
  } catch (error) {
    console.error('Error deleting suggestion type:', error);
    sendResponse({ success: false, error: error.message });
  }
}

async function handleToggleSuggestionType(suggestionType, isEnabled, sendResponse) {
  try {
    const credentials = await getCredentials();
    if (!credentials || !credentials.accessToken) {
      sendResponse({ success: false, error: 'User not authenticated' });
      return;
    }

    let profile = await getProfile();
    if (!profile) {
      profile = await fetchProfile();
    }
    if (!profile || !profile.default_suggestion_type_group_id) {
      sendResponse({ success: false, error: 'Profile not available' });
      return;
    }

    const suggestionTypeGroupId = profile.default_suggestion_type_group_id;
    const baseUrl = getSuggestionTypesBaseUrl();
    const endpoint = `${baseUrl}/${suggestionTypeGroupId}/suggestion-type-id/${suggestionType.id}/toggle?is_enabled=${isEnabled}`;

    const response = await fetch(endpoint, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${credentials.accessToken}`,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      sendResponse({ success: false, error: `Failed to toggle: ${response.status} ${errorText}` });
      return;
    }

    const data = await response.json();

    // Update cache
    const index = suggestionTypesCache.findIndex(t => t.id === data.id);
    if (index >= 0) {
      suggestionTypesCache[index] = data;
    }

    console.log('Toggled suggestion type:', data.id);
    sendResponse({ success: true, suggestionType: data });
  } catch (error) {
    console.error('Error toggling suggestion type:', error);
    sendResponse({ success: false, error: error.message });
  }
}

async function handleResetSuggestionTypes(sendResponse) {
  try {
    const credentials = await getCredentials();
    if (!credentials || !credentials.accessToken) {
      sendResponse({ success: false, error: 'User not authenticated' });
      return;
    }

    let profile = await getProfile();
    if (!profile) {
      profile = await fetchProfile();
    }
    if (!profile || !profile.default_suggestion_type_group_id) {
      sendResponse({ success: false, error: 'Profile not available' });
      return;
    }

    const suggestionTypeGroupId = profile.default_suggestion_type_group_id;
    const baseUrl = getSuggestionTypesBaseUrl();
    const endpoint = `${baseUrl}/${suggestionTypeGroupId}/reset`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${credentials.accessToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({})
    });

    if (!response.ok) {
      const errorText = await response.text();
      sendResponse({ success: false, error: `Failed to reset: ${response.status} ${errorText}` });
      return;
    }

    const data = await response.json();
    const count = data.count || 0;

    // Clear cache to force refresh
    suggestionTypesCache = [];
    suggestionTypesCacheTimestamp = null;

    console.log(`Reset suggestion types: ${count} defaults created`);
    sendResponse({ success: true, count });
  } catch (error) {
    console.error('Error resetting suggestion types:', error);
    sendResponse({ success: false, error: error.message });
  }
}

async function validateJWT(validationParams) {
  const promises = validationParams.map(([token, url]) => validateJWTWithJWKS(token, url));
  return Promise.all(promises);
}
// Auth
async function authorize() {
  // Track login started
  trackAuthEvents.loginStarted();

  return new Promise((resolve, reject) => {
    console.log('Starting Auth0 authorization...');
     
    console.log('Auth0 Domain:', AUTH0_DOMAIN);
     
    console.log('Client ID:', CLIENT_ID);
     
    console.log('Audience:', AUDIENCE);

    const authOptions = {
      url:
         
        `https://${AUTH0_DOMAIN
         
        }/authorize?audience=${AUDIENCE
         
        }&client_id=${CLIENT_ID
        }&redirect_uri=${encodeURIComponent(browserCompat.getRedirectURI())
        }&response_type=${encodeURIComponent('code')
        }&scope=${encodeURIComponent('openid profile email offline_access')
        }&nonce=${generateNonce()}`,
      interactive: true
    };

    console.log('Auth URL:', authOptions.url);

    browserCompat.launchWebAuthFlow(authOptions)
      .then((redirectUrl) => {
        console.log('Received redirect URL:', redirectUrl);
        const url = new URL(redirectUrl);
        const authCode = url.searchParams.get('code');
        if (authCode != null) {
          console.log('Auth code received, fetching token...');
          fetchToken(authCode).then(response => {
            const accessToken = response['access_token'];
            const refreshToken = response['refresh_token'];
            const idToken = response['id_token'];

            const validationParams = [
               
              [idToken, jwksUrl],
               
              [accessToken, jwksUrl]
            ];
            validateJWT(validationParams)
              .then(results => {
                const validationResults = results.map((result) => result.valid);
                const validationResult = validationResults.reduce((accumulator, currentValue) => accumulator && currentValue, true);

                if (validationResult) {
                  const decodeJWTs = async function () {
                    const decodedIdToken = await decodeJWT(idToken);
                    const jwtPayload = decodedIdToken.payload;
                    const credentials = { accessToken, refreshToken, idToken };

                    await saveCredentials(credentials);

                    // Use user data directly from ID token instead of calling /user endpoint
                    const userData = {
                      first_name: jwtPayload['given_name'] || jwtPayload['name'] || 'User',
                      email: jwtPayload['email'] || 'user@example.com',
                      photo_url: jwtPayload['picture'] || '',
                    };

                    console.log('Authorization successful:', userData);

                    // Track login success
                    trackAuthEvents.loginSucceeded('auth0');

                    // Fetch and store profile data after successful authentication
                    fetchProfile().then(profile => {
                      if (profile) {
                        console.log('Profile fetched and stored after authentication');
                        // Set analytics user properties
                        setAnalyticsUser(userData, profile);
                      } else {
                        console.warn('Failed to fetch profile after authentication');
                        // Set analytics user with just userData
                        setAnalyticsUser(userData);
                      }
                    }).catch(error => {
                      console.warn('Error fetching profile after authentication:', error);
                      // Set analytics user with just userData
                      setAnalyticsUser(userData);
                    });

                    resolve(userData);
                  };
                  decodeJWTs();
                } else {
                  console.error('JWT validation failed');
                  trackAuthEvents.loginFailed('JWT validation failed');
                  reject({ message: 'An error has occured.' });
                }
              }).catch((error) => {
                console.error('JWT validation error:', error);
                trackAuthEvents.loginFailed(`JWT validation error: ${error.message || error}`);
                reject({ message: 'An error has occured.' });
              });
          }).catch((error) => {
            console.error('Token fetch error:', error);
            trackAuthEvents.loginFailed(`Token fetch error: ${error.message || error}`);
            reject({ message: 'An error has occured.' });
          });
        } else {
          console.error('No auth code in redirect URL');
          trackAuthEvents.loginFailed('No auth code in redirect URL');
          reject({ message: 'An error has occured.' });
        }
      })
      .catch((error) => {
        console.error('OAuth flow error:', error);
        trackAuthEvents.loginFailed(`OAuth flow error: ${error.message || error}`);
        reject(error);
      });
  });
}
// Secure Persistent Credential Storage
// Uses AES-GCM encryption to persist credentials across service worker restarts

/**
 * Encrypted persistent credential and profile storage.
 * Combines a memory cache for fast access with AES-GCM encrypted
 * chrome.storage.local persistence so credentials survive service worker restarts.
 */
class SecureCredentialStore {
  constructor() {
    this.credentials = null;
    this.credentialTimestamp = null;
    this.profile = null;
    this.profileTimestamp = null;
    this.maxAge = 8 * 60 * 60 * 1000; // 8 hours
    this.masterKey = null;
    this.storageKeys = {
      credentials: 'ps_encrypted_credentials',
      credentialMeta: 'ps_credential_metadata',
      profile: 'ps_encrypted_profile',
      profileMeta: 'ps_profile_metadata',
      masterKey: 'ps_master_key_data'
    };

    // Kick off async restoration; getCredentials/getProfile await this before reading
    this._restorePromise = this._restoreFromStorage();

    this._setupPeriodicCleanup();
  }

  // ── Encryption helpers ──────────────────────────────────────────────

  async _getOrCreateMasterKey() {
    if (this.masterKey) return this.masterKey;

    try {
      const result = await chrome.storage.local.get([this.storageKeys.masterKey]);

      if (result[this.storageKeys.masterKey]) {
        this.masterKey = await crypto.subtle.importKey(
          'raw',
          this._base64ToArrayBuffer(result[this.storageKeys.masterKey]),
          { name: 'AES-GCM' },
          false,
          ['encrypt', 'decrypt']
        );
        return this.masterKey;
      }

      // Generate a new 256-bit AES-GCM key
      const key = await crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        true, // extractable so we can export for storage
        ['encrypt', 'decrypt']
      );

      const exported = await crypto.subtle.exportKey('raw', key);
      await chrome.storage.local.set({
        [this.storageKeys.masterKey]: this._arrayBufferToBase64(exported)
      });

      // Re-import as non-extractable for runtime use
      this.masterKey = await crypto.subtle.importKey(
        'raw',
        exported,
        { name: 'AES-GCM' },
        false,
        ['encrypt', 'decrypt']
      );

      console.log('Generated new master encryption key');
      return this.masterKey;
    } catch (error) {
      console.error('Failed to get/create master key:', error);
      throw error;
    }
  }

  async _encrypt(plaintext) {
    const key = await this._getOrCreateMasterKey();
    const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV for GCM
    const encoded = new TextEncoder().encode(plaintext);

    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      encoded
    );

    // Prepend IV to ciphertext so we can extract it during decryption
    const combined = new Uint8Array(12 + ciphertext.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(ciphertext), 12);

    return this._arrayBufferToBase64(combined.buffer);
  }

  async _decrypt(encryptedBase64) {
    const key = await this._getOrCreateMasterKey();
    const combined = new Uint8Array(this._base64ToArrayBuffer(encryptedBase64));

    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext
    );

    return new TextDecoder().decode(decrypted);
  }

  _arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  _base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  // ── Persistence ─────────────────────────────────────────────────────

  async _ensureRestored() {
    if (this._restorePromise) {
      await this._restorePromise;
      this._restorePromise = null;
    }
  }

  async _restoreFromStorage() {
    try {
      // Restore credentials
      const credResult = await chrome.storage.local.get([
        this.storageKeys.credentials,
        this.storageKeys.credentialMeta
      ]);

      if (credResult[this.storageKeys.credentials] && credResult[this.storageKeys.credentialMeta]) {
        const meta = credResult[this.storageKeys.credentialMeta];

        if (meta.expiresAt && Date.now() < meta.expiresAt) {
          const decrypted = await this._decrypt(credResult[this.storageKeys.credentials]);
          this.credentials = JSON.parse(decrypted);
          this.credentialTimestamp = meta.timestamp;
          console.log('Credentials restored from encrypted storage');
        } else {
          console.log('Stored credentials have expired, clearing');
          await chrome.storage.local.remove([this.storageKeys.credentials, this.storageKeys.credentialMeta]);
        }
      }

      // Restore profile
      const profResult = await chrome.storage.local.get([
        this.storageKeys.profile,
        this.storageKeys.profileMeta
      ]);

      if (profResult[this.storageKeys.profile] && profResult[this.storageKeys.profileMeta]) {
        const meta = profResult[this.storageKeys.profileMeta];

        if (meta.expiresAt && Date.now() < meta.expiresAt) {
          const decrypted = await this._decrypt(profResult[this.storageKeys.profile]);
          this.profile = JSON.parse(decrypted);
          this.profileTimestamp = meta.timestamp;
          console.log('Profile restored from encrypted storage');
        } else {
          console.log('Stored profile has expired, clearing');
          await chrome.storage.local.remove([this.storageKeys.profile, this.storageKeys.profileMeta]);
        }
      }
    } catch (error) {
      console.warn('Failed to restore from encrypted storage (starting fresh):', error);
    }
  }

  async _persistCredentials() {
    if (!this.credentials) return;

    try {
      const encrypted = await this._encrypt(JSON.stringify(this.credentials));
      const meta = {
        timestamp: this.credentialTimestamp,
        expiresAt: this.credentialTimestamp + this.maxAge,
        version: '1.0'
      };

      await chrome.storage.local.set({
        [this.storageKeys.credentials]: encrypted,
        [this.storageKeys.credentialMeta]: meta
      });

      console.log('Credentials persisted to encrypted storage');
    } catch (error) {
      console.error('Failed to persist credentials:', error);
    }
  }

  async _persistProfile() {
    if (!this.profile) return;

    try {
      const encrypted = await this._encrypt(JSON.stringify(this.profile));
      const meta = {
        timestamp: this.profileTimestamp,
        expiresAt: this.profileTimestamp + this.maxAge,
        version: '1.0'
      };

      await chrome.storage.local.set({
        [this.storageKeys.profile]: encrypted,
        [this.storageKeys.profileMeta]: meta
      });

      console.log('Profile persisted to encrypted storage');
    } catch (error) {
      console.error('Failed to persist profile:', error);
    }
  }

  // ── Public API ──────────────────────────────────────────────────────

  async saveCredentials(credentials) {
    if (!credentials || !credentials.accessToken || !credentials.refreshToken || !credentials.idToken) {
      console.warn('Invalid credentials provided to saveCredentials');
      return;
    }

    this.credentials = {
      accessToken: credentials.accessToken,
      refreshToken: credentials.refreshToken,
      idToken: credentials.idToken
    };
    this.credentialTimestamp = Date.now();

    await this._persistCredentials();
    console.log('Credentials stored securely (memory + encrypted storage)');
  }

  async getCredentials() {
    await this._ensureRestored();

    if (!this.credentials || !this.credentialTimestamp) {
      return null;
    }

    if (Date.now() - this.credentialTimestamp > this.maxAge) {
      console.log('Credentials expired, clearing');
      await this.clearCredentials();
      return null;
    }

    return {
      accessToken: this.credentials.accessToken,
      refreshToken: this.credentials.refreshToken,
      idToken: this.credentials.idToken
    };
  }

  async saveProfile(profile) {
    if (!profile || !profile.content) {
      console.warn('Invalid profile data provided to saveProfile');
      return;
    }

    this.profile = {
      id: profile.content.id,
      default_organisation_id: profile.content.default_organisation_id,
      default_subscription_id: profile.content.default_subscription_id,
      default_project_id: profile.content.default_project_id,
      default_tenant_id: profile.content.default_tenant_id,
      default_team_id: profile.content.default_team_id,
      default_suggestion_group_id: profile.content.default_suggestion_group_id,
      default_suggestion_type_group_id: profile.content.default_suggestion_type_group_id,
      created_at: profile.content.created_at,
      updated_at: profile.content.updated_at
    };
    this.profileTimestamp = Date.now();

    await this._persistProfile();
    console.log('Profile stored securely (memory + encrypted storage)');
  }

  async getProfile() {
    await this._ensureRestored();

    if (!this.profile || !this.profileTimestamp) {
      return null;
    }

    if (Date.now() - this.profileTimestamp > this.maxAge) {
      console.log('Profile expired, clearing');
      await this.clearProfile();
      return null;
    }

    return { ...this.profile };
  }

  async clearCredentials() {
    if (this.credentials) {
      this.credentials.accessToken = null;
      this.credentials.refreshToken = null;
      this.credentials.idToken = null;
    }
    this.credentials = null;
    this.credentialTimestamp = null;

    try {
      await chrome.storage.local.remove([this.storageKeys.credentials, this.storageKeys.credentialMeta]);
    } catch (error) {
      console.warn('Failed to clear persistent credentials:', error);
    }

    console.log('Credentials cleared (memory + storage)');
  }

  async clearProfile() {
    if (this.profile) {
      Object.keys(this.profile).forEach(key => {
        this.profile[key] = null;
      });
    }
    this.profile = null;
    this.profileTimestamp = null;

    try {
      await chrome.storage.local.remove([this.storageKeys.profile, this.storageKeys.profileMeta]);
    } catch (error) {
      console.warn('Failed to clear persistent profile:', error);
    }

    console.log('Profile cleared (memory + storage)');
  }

  async clearAll() {
    await this.clearCredentials();
    await this.clearProfile();
    console.log('All secure data cleared (memory + storage)');
  }

  hasValidCredentials() {
    return this.credentials !== null && this.credentialTimestamp !== null &&
      (Date.now() - this.credentialTimestamp <= this.maxAge);
  }

  hasValidProfile() {
    return this.profile !== null && this.profileTimestamp !== null &&
      (Date.now() - this.profileTimestamp <= this.maxAge);
  }

  _setupPeriodicCleanup() {
    setInterval(async () => {
      if (this.credentials && this.credentialTimestamp) {
        if (Date.now() - this.credentialTimestamp > this.maxAge) {
          console.log('Periodic cleanup: removing expired credentials');
          await this.clearCredentials();
        }
      }

      if (this.profile && this.profileTimestamp) {
        if (Date.now() - this.profileTimestamp > this.maxAge) {
          console.log('Periodic cleanup: removing expired profile');
          await this.clearProfile();
        }
      }
    }, 30 * 60 * 1000);
  }

  getCredentialAge() {
    if (!this.credentialTimestamp) return null;
    return Date.now() - this.credentialTimestamp;
  }
}

// Create singleton instance
const credentialStore = new SecureCredentialStore();

async function saveCredentials(credentials) {
  await credentialStore.saveCredentials(credentials);
}

async function removeCredentials() {
  trackAuthEvents.logoutStarted();

  await credentialStore.clearAll();

  await resetAnalyticsUser();

  try {
    await browserCompat.removeStorage('encryptedToken');
    await browserCompat.removeStorage('salt');
    console.log('Legacy persistent credentials cleared');
  } catch (error) {
    console.warn('Failed to clear legacy storage (this is normal on first run):', error);
  }

  trackAuthEvents.logoutCompleted();
}

async function getCredentials() {
  return credentialStore.getCredentials();
}

async function saveProfile(profile) {
  await credentialStore.saveProfile(profile);
}

async function getProfile() {
  return credentialStore.getProfile();
}

/**
 * Fetch user profile from the profile service
 * @returns {Promise<Object|null>} Profile data or null if failed
 */
async function fetchProfile() {
  try {
    const credentials = await getCredentials();
    if (!credentials || !credentials.accessToken) {
      console.warn('No valid credentials available for profile fetch');
      return null;
    }

    // Get profile service URL from unified config with fallback
    const profileUrl = getApiUrl('profileServiceUrl');

    const response = await fetch(profileUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${credentials.accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      console.error('Profile fetch failed:', response.status, response.statusText);
      return null;
    }

    const profileData = await response.json();

    if (profileData.success && profileData.content) {
      console.log('Profile fetched successfully');
      // Store the profile data securely in memory
      await saveProfile(profileData);
      return profileData.content;
    } else {
      console.warn('Profile fetch returned unsuccessful response:', profileData);
      return null;
    }
  } catch (error) {
    console.error('Error fetching profile:', error);
    return null;
  }
}
// Legacy encryption functions removed - no longer needed for in-memory storage
// getSalt() and getEncryptionKey() functions removed as credentials are now stored in memory only
// deriveKey function removed - no longer needed for in-memory storage
function base64UrlDecode(str) {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - base64.length % 4) % 4);
  const decodedData = atob(base64 + padding);

  return Uint8Array.from(decodedData, c => c.charCodeAt(0));
}
async function decodeJWT(token) {
  const [header, payload, signature] = token.split('.');
  const decodedHeader = JSON.parse(new TextDecoder().decode(await base64UrlDecode(header)));
  const decodedPayload = JSON.parse(new TextDecoder().decode(await base64UrlDecode(payload)));

  return {
    header: decodedHeader,
    payload: decodedPayload,
    signature,
  };
}
async function fetchJWKS(jwksUrl) {
  const response = await fetch(jwksUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch JWKS: ${response.status}`);
  }
  const jwks = await response.json();
  return jwks.keys;
}
function getJWKForKeyId(jwks, kid) {
  return jwks.find(key => key.kid === kid);
}
async function importPublicKeyFromJWK(jwk) {
  const keyData = {
    kty: jwk.kty,
    n: jwk.n,
    e: jwk.e,
  };

  return await crypto.subtle.importKey(
    'jwk',
    keyData,
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: { name: 'SHA-256' },
    },
    false,
    ['verify']
  );
}
async function verifySignature(token, publicKey) {
  const [header, payload, signature] = token.split('.');
  const data = `${header}.${payload}`;
  const decodedSignature = await base64UrlDecode(signature);

  return await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    publicKey,
    decodedSignature,
    new TextEncoder().encode(data)
  );
}
async function validateJWTWithJWKS(token, jwksUrl) {
  try {
    const decoded = await decodeJWT(token);
    const jwks = await fetchJWKS(jwksUrl);
    const jwk = getJWKForKeyId(jwks, decoded.header.kid);
    const publicKey = await importPublicKeyFromJWK(jwk);
    const isSignatureValid = await verifySignature(token, publicKey);
    const now = Math.floor(Date.now() / 1000);

    if (!jwk) {
      throw new Error('Matching JWK not found for the token\'s kid');
    }
    if (!isSignatureValid) {
      return { valid: false, error: 'Invalid signature' };
    }
    if (decoded.payload.exp && now > decoded.payload.exp) {
      return { valid: false, error: 'Token has expired' };
    }
    return { valid: true, payload: decoded.payload };
  } catch (error) {
    return { valid: false, error: `Validation failed: ${error.message}` };
  }
}
// Events
function sendAuthUpdate(isAuthenticated) {
  chrome.tabs.query({ currentWindow: true }, (tabs) => {
    if (tabs.length > 0) {
      // Try to send message to all tabs that might have content scripts
      tabs.forEach(tab => {
        // Only send to tabs that match our content script patterns
        const url = tab.url || '';
        const isSupportedSite = url.includes('openai.com') ||
          url.includes('chatgpt.com') ||
          url.includes('huggingface.co') ||
          url.includes('anthropic.com') ||
          url.includes('claude.ai') ||
          url.includes('cohere.ai') ||
          url.includes('stability.ai') ||
          url.includes('perplexity.ai') ||
          url.includes('copy.ai') ||
          url.includes('jasper.ai') ||
          url.includes('midjourney.com') ||
          url.includes('scribehow.com') ||
          url.includes('writesonic.com') ||
          url.includes('speechmatics.com') ||
          url.includes('gradio.app') ||
          url.includes('notion.so') ||
          url.includes('fathom.video') ||
          url.includes('gptzero.me') ||
          url.includes('fireflies.ai') ||
          url.includes('deepseek.com') ||
          url.includes('poe.com') ||
          url.includes('synthesia.io') ||
          url.includes('elevenlabs.io') ||
          url.includes('replika.ai') ||
          url.includes('murf.ai') ||
          url.includes('grammarly.com') ||
          url.includes('gemini.google.com') ||
          url.includes('copilot.microsoft.com') ||
          url.includes('character.ai') ||
          url.includes('you.com') ||
          url.includes('chatbotapp.ai') ||
          url.includes('localhost');

        if (isSupportedSite) {
          chrome.tabs.sendMessage(tab.id, { type: 'authenticationUpdate', isAuthenticated }, (response) => {
            if (chrome.runtime.lastError) {
              // This is expected if content script isn't loaded yet
              console.log(`Content script not ready on tab ${tab.id}:`, chrome.runtime.lastError.message);
            } else {
              console.log('Response from content script:', response);
            }
          });
        }
      });
    } else {
      console.log('No active tab found.');
    }
  });
}
// API

async function fetchToken(code) {
   
  return await fetch(tokenUrl, {
    headers: {
      'Content-Type': 'application/json'
    },
    method: 'POST',
    body: JSON.stringify({
      'grant_type': 'authorization_code',
       
      'client_id': CLIENT_ID,
      'code': `${code}`,
      'redirect_uri': browserCompat.getRedirectURI()
    })
  }).then((response) => {
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return response.json(); // Parse JSON data
  });
}

Promise.prototype.interceptTokenRefresh = function (isTokenExpired, refreshToken, retryRequest) {
  return this.catch(async (error) => {
    // Check if the token has expired
    if (isTokenExpired(error)) {
      console.log('Token expired. Refreshing token...');

      // eslint-disable-next-line no-useless-catch
      try {
        // Refresh the token
        const newToken = await refreshToken();
        console.log('Token refreshed.');

        // Retry the original request with the new token
        return retryRequest(newToken);
      } catch (refreshError) {
        throw refreshError;
      }
    }

    // If not a token expiration error, propagate the original error
    throw error;
  });
};
connectPort();
