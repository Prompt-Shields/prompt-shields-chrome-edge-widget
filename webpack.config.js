const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');

/**
 * Extract environment-specific configuration from the source config file
 * This parses the config.js file and returns only the specified environment's config
 * @param {string} configContent - The raw content of config.js
 * @param {string} environment - The target environment ('dev' or 'prod')
 * @returns {Object} The environment-specific configuration object
 */
function getEnvConfig(configContent, environment) {
  // Use a more robust approach: evaluate the CONFIGS object
  // We extract just the CONFIGS declaration and parse it
  const configsMatch = configContent.match(/const CONFIGS\s*=\s*(\{[\s\S]*?\n\});/);

  if (!configsMatch) {
    throw new Error('Could not find CONFIGS object in config.js');
  }

  try {
    // Create a function that returns the configs object
    // This safely evaluates the config without executing other code
    const configsStr = configsMatch[1];
    // eslint-disable-next-line no-new-func
    const configsObj = new Function(`return ${configsStr}`)();

    if (!configsObj[environment]) {
      throw new Error(`Environment '${environment}' not found in CONFIGS`);
    }

    return configsObj[environment];
  } catch (error) {
    console.error('Failed to parse CONFIGS:', error);
    throw error;
  }
}

module.exports = (env, argv) => {
  const isProduction = argv.mode === 'production';
  const target = env.target || 'chrome'; // Default to chrome, can be 'edge'

  // Determine environment for config file
  let configEnv;
  if (env.environment) {
    configEnv = env.environment;
  } else {
    // Default based on production mode
    configEnv = isProduction ? 'prod' : 'dev';
  }

  console.log(`Building for ${target} with ${configEnv} configuration (mode: ${argv.mode})`);

  // Get environment-specific API host for manifest and HTML transformations
  const fs = require('fs');
  const configFileContent = fs.readFileSync('./src/config/config.js', 'utf8');
  const envConfig = getEnvConfig(configFileContent, configEnv);
  const apiHost = envConfig.api.host;

  console.log(`Using API host: ${apiHost}`);

  return {
    entry: {
      background: './src/background.js',
      content: './src/content.js',
      popup: './src/popup.js',
      'pages/settings': './src/pages/settings.js',
      'pages/account': './src/pages/account.js',
      'pages/history': './src/pages/history.js'
    },
    output: {
      path: path.resolve(__dirname, `dist-${target}`),
      filename: '[name].js',
      clean: true
    },
    module: {
      rules: [
        {
          test: /\.js$/,
          exclude: /node_modules/,
          use: [
            {
              loader: 'babel-loader',
              options: {
                presets: ['@babel/preset-env']
              }
            },
            {
              loader: 'string-replace-loader',
              options: {
                search: '__API_HOST__',
                replace: apiHost,
                flags: 'g'
              }
            }
          ]
        },
        {
          test: /\.css$/,
          use: [
            MiniCssExtractPlugin.loader,
            'css-loader'
          ]
        }
      ]
    },
    plugins: [
      new MiniCssExtractPlugin({
        filename: '[name].css'
      }),
      new CopyPlugin({
        patterns: [
          {
            from: `src/manifest-${target}.json`,
            to: 'manifest.json',
            transform(content) {
              let manifestStr = content.toString();

              manifestStr = manifestStr.replace(/__API_HOST__/g, apiHost);

              const manifest = JSON.parse(manifestStr);

              // Update name based on environment
              if (configEnv === 'dev') {
                manifest.name = `${manifest.name} Dev`;
              }

              return JSON.stringify(manifest, null, 2);
            }
          },
          { from: 'src/managed_schema.json', to: 'managed_schema.json' },
          { from: 'src/popup.html', to: 'popup.html' },
          { from: 'src/popup.css', to: 'popup.css' },
          { from: 'src/style.css', to: 'style.css' },
          // Transform HTML files to use the correct API host in CSP headers
          {
            from: 'src/pages/account.html',
            to: 'pages/account.html',
            transform(content) {
              return content.toString().replace(/__API_HOST__/g, apiHost);
            }
          },
          { from: 'src/pages/account.css', to: 'pages/account.css' },
          {
            from: 'src/pages/settings.html',
            to: 'pages/settings.html',
            transform(content) {
              return content.toString().replace(/__API_HOST__/g, apiHost);
            }
          },
          { from: 'src/pages/settings.css', to: 'pages/settings.css' },
          {
            from: 'src/pages/history.html',
            to: 'pages/history.html',
            transform(content) {
              return content.toString().replace(/__API_HOST__/g, apiHost);
            }
          },
          { from: 'src/pages/history.css', to: 'pages/history.css' },
          { from: 'src/images', to: 'images' },
          { from: 'src/icons', to: '.' },
          // Ported Safari content-script modules (copied raw, not bundled).
          // Exclude the node:test module tests from the extension output.
          {
            from: 'src/lib',
            to: 'lib',
            globOptions: { ignore: ['**/tests/**'] },
          },
          // Copy unified config file with ONLY the selected environment's configuration
          // This is important for security - we don't want to expose other environment configs
          {
            from: 'src/config/config.js',
            to: 'config/config.js',
            transform(content) {
              const configContent = content.toString();

              // Extract the specific environment's config using regex
              // Match the config object for the target environment
              const configMatch = configContent.match(new RegExp(
                `${configEnv}:\\s*\\{[\\s\\S]*?(?=\\n  \\w+:|\\n\\};)`, 'm'
              ));

              if (!configMatch) {
                console.warn(`Could not extract ${configEnv} config, using fallback approach`);
                // Fallback: just inject the environment variable
                return configContent.replace(
                  '// BUILD_TIME_ENVIRONMENT_PLACEHOLDER',
                  `// Build-time environment injection\nconst BUILD_TIME_ENVIRONMENT = '${configEnv}';`
                );
              }

              // Create a new config file that only contains the selected environment
              const singleEnvConfig = `/**
 * PromptShields Configuration
 * Environment: ${configEnv}
 * Generated at build time - contains only ${configEnv} configuration
 */

const CONFIG = ${JSON.stringify(getEnvConfig(configContent, configEnv), null, 2)};

function buildApiEndpoints(apiConfig) {
  const { baseUrl } = apiConfig;
  return {
    profileServiceUrl: \`\${baseUrl}/api/v2/profiles/\`,
    profilePhotoServiceUrl: \`\${baseUrl}/api/v2/profiles/photo\`,
    suggestionHistoryUrl: \`\${baseUrl}/api/v2/teams/{teamId}/suggestion_group/{suggestionGroupId}/suggestions\`,
    suggestionTypesServiceUrl: \`\${baseUrl}/api/v2/suggestion/types\`,
    suggestionProcessServiceUrl: \`\${baseUrl}/api/v2/suggestion/analyze/\`,
    chat: \`\${baseUrl}/api/v2/chat\`,
    suggestionTypesBaseUrl: \`\${baseUrl}/api/v2/suggestion-types\`,
    suggestionTypesByGroupUrl: \`\${baseUrl}/api/v2/suggestion-types/{suggestionTypeGroupId}\`,
    suggestionTypeByIdUrl: \`\${baseUrl}/api/v2/suggestion-types/{suggestionTypeGroupId}/suggestion-type-id/{suggestionTypeId}\`,
    suggestionTypeToggleUrl: \`\${baseUrl}/api/v2/suggestion-types/{suggestionTypeGroupId}/suggestion-type-id/{suggestionTypeId}/toggle\`,
    suggestionTypeResetUrl: \`\${baseUrl}/api/v2/suggestion-types/{suggestionTypeGroupId}/reset\`
  };
}

function buildAuth0Config(auth0Config) {
  const { domain, clientId, audience } = auth0Config;
  let redirectUri;
  if (typeof chrome !== 'undefined' && chrome.identity && chrome.identity.getRedirectURL) {
    try {
      redirectUri = chrome.identity.getRedirectURL();
    } catch (error) {
      console.warn('Could not get Chrome extension redirect URI:', error);
      if (chrome.runtime && chrome.runtime.id) {
        redirectUri = \`https://\${chrome.runtime.id}.chromiumapp.org\`;
      }
    }
  } else if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
    redirectUri = \`https://\${chrome.runtime.id}.chromiumapp.org\`;
  }
  return {
    domain,
    clientId,
    audience,
    redirectUri,
    tokenUrl: \`https://\${domain}/oauth/token\`,
    jwksUrl: \`https://\${domain}/.well-known/jwks.json\`,
    authUrl: \`https://\${domain}/authorize\`
  };
}

class Config {
  constructor() {
    this.environment = '${configEnv}';
    this.config = null;
    this.isInitialized = false;
  }

  init(forceEnv = null) {
    if (this.isInitialized && !forceEnv) {
      return this.config;
    }

    // Use build-time environment - forceEnv is ignored in production builds for security
    if (forceEnv && forceEnv !== '${configEnv}') {
      console.warn(\`Requested environment '\${forceEnv}' but this build only contains '${configEnv}' config\`);
    }

    this.config = {
      environment: this.environment,
      api: {
        ...CONFIG.api,
        endpoints: buildApiEndpoints(CONFIG.api)
      },
      auth0: buildAuth0Config(CONFIG.auth0),
      analytics: CONFIG.analytics
    };

    this.isInitialized = true;
    console.log('Configuration initialized for environment:', this.environment);
    return this.config;
  }

  get() {
    if (!this.isInitialized) {
      return this.init();
    }
    return this.config;
  }

  getEnvironment() {
    return this.environment;
  }

  getApi() {
    return this.get().api;
  }

  getAuth0() {
    return this.get().auth0;
  }

  getAnalytics() {
    const config = this.get();
    return config.analytics || {
      enabled: true,
      debugMode: this.environment === 'dev',
      googleAnalytics: { measurementId: '', apiSecret: '' },
      postHog: { apiKey: '', host: 'https://app.posthog.com' },
      firebase: { apiKey: '', projectId: '', appId: '' }
    };
  }

  getApiUrl(endpoint) {
    const endpoints = this.get().api.endpoints;
    if (!endpoints[endpoint]) {
      throw new Error('Unknown API endpoint: ' + endpoint);
    }
    return endpoints[endpoint];
  }

  buildApiUrl(endpoint, params = {}) {
    let url = this.getApiUrl(endpoint);
    Object.entries(params).forEach(([key, value]) => {
      const placeholder = '{' + key + '}';
      url = url.replace(placeholder, encodeURIComponent(value));
    });
    const remainingPlaceholders = url.match(/\\{[^}]+\\}/g);
    if (remainingPlaceholders) {
      throw new Error('Missing parameters for URL template: ' + remainingPlaceholders.join(', '));
    }
    return url;
  }

  isLoaded() {
    return this.isInitialized;
  }

  reload(forceEnv = null) {
    this.isInitialized = false;
    return this.init(forceEnv);
  }
}

const config = new Config();

// Initialize the config immediately
config.init();
console.log('Config instance created and initialized');
console.log('Config methods available:', Object.getOwnPropertyNames(Object.getPrototypeOf(config)));

// ALWAYS set Config as a global - this is critical for importScripts to work
// In service workers: self is the global scope
// In browsers: window is the global scope  
// We set it on both to ensure compatibility
if (typeof self !== 'undefined') {
  self.Config = config;
  self.configSystem = { config: config, ConfigClass: Config };
  console.log('Config set on self (service worker/shared worker)');
}

if (typeof window !== 'undefined') {
  window.Config = config;
  window.configSystem = { config: config, ConfigClass: Config };
  
  // Also set window globals for backward compatibility
  try {
    const configData = config.get();
    const endpoints = configData.api.endpoints;
    window.apiHost = configData.api.baseUrl;
    window.profileServiceUrl = endpoints.profileServiceUrl;
    window.profilePhotoServiceUrl = endpoints.profilePhotoServiceUrl;
    window.suggestionHistoryUrl = endpoints.suggestionHistoryUrl;
    window.suggestionTypesServiceUrl = endpoints.suggestionTypesServiceUrl;
    window.suggestionProcessServiceUrl = endpoints.suggestionProcessServiceUrl;
    window.suggestionTypesBaseUrl = endpoints.suggestionTypesBaseUrl;
    window.suggestionTypesByGroupUrl = endpoints.suggestionTypesByGroupUrl;
    window.suggestionTypeByIdUrl = endpoints.suggestionTypeByIdUrl;
    window.suggestionTypeToggleUrl = endpoints.suggestionTypeToggleUrl;
    window.suggestionTypeResetUrl = endpoints.suggestionTypeResetUrl;
  } catch (error) {
    console.error('Failed to initialize window globals:', error);
  }
  console.log('Config set on window');
}

// Also support CommonJS for Node.js bundling
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { config: config, Config: Config };
}
`;
              return singleEnvConfig;
            }
          },
          // Copy other config files (messageTypes, securityConfig) but NOT config.js again
          {
            from: 'src/config',
            to: 'config',
            globOptions: {
              ignore: ['**/config.js']
            }
          }
        ]
      })
    ],
    devtool: isProduction ? false : 'source-map',
    optimization: {
      minimize: isProduction
    }
  };
};
