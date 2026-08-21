// Enum-like object for extension message types
export const MessageTypes = {
  AUTHORIZE: 'authorize',
  LOGOUT: 'logout',
  PING: 'ping',
  GET_USER: 'getUser',
  GET_CREDENTIALS: 'getCredentials',
  AUTHENTICATION_UPDATE: 'authenticationUpdate',
  CONTENT_AUTH_UPDATE: 'contentAuthenticationUpdate',
  DECODE_TOKEN: 'decodeToken',
  STREAMING_UPDATE: 'streamingUpdate',
  STREAMING_ERROR: 'streamingError',
  STREAMING_COMPLETE: 'streamingComplete',
  GET_PROFILE: 'getProfile',
  PROFILE_UPDATE: 'profileUpdate',
  // Account management
  UPLOAD_PHOTO: 'uploadPhoto',
  DELETE_PHOTO: 'deletePhoto',
  UPDATE_USER_DATA: 'updateUserData',
  // History management
  GET_SUGGESTIONS_HISTORY: 'getSuggestionsHistory',
  // Page navigation
  OPEN_ACCOUNT_PAGE: 'openAccountPage',
  OPEN_HISTORY_PAGE: 'openHistoryPage',
  OPEN_SETTINGS_PAGE: 'openSettingsPage',
  // Custom Suggestion Types CRUD operations
  FETCH_SUGGESTION_TYPES: 'fetchSuggestionTypes',
  LIST_SUGGESTION_TYPES: 'listSuggestionTypes',
  CREATE_SUGGESTION_TYPE: 'createSuggestionType',
  UPDATE_SUGGESTION_TYPE: 'updateSuggestionType',
  DELETE_SUGGESTION_TYPE: 'deleteSuggestionType',
  TOGGLE_SUGGESTION_TYPE: 'toggleSuggestionType',
  RESET_SUGGESTION_TYPES: 'resetSuggestionTypes',
  SUGGESTION_TYPES_UPDATED: 'suggestionTypesUpdated',
};
