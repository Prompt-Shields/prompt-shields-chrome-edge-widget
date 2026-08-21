/**
 * XSS Protection utilities for PromptShields extension
 * Provides secure DOM manipulation and input sanitization
 */

/**
 * Comprehensive HTML sanitizer using DOMPurify-like approach
 */
class HTMLSanitizer {
  constructor() {
    // Define allowed tags and attributes
    this.allowedTags = new Set([
      'div', 'span', 'p', 'br', 'strong', 'em', 'b', 'i', 'u',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li',
      'a', 'img', 'pre', 'code', 'blockquote'
    ]);

    this.allowedAttributes = new Map([
      ['a', new Set(['href', 'title', 'target'])],
      ['img', new Set(['src', 'alt', 'title', 'width', 'height'])],
      ['*', new Set(['class', 'id', 'style'])] // Global attributes
    ]);

    // Dangerous protocols to block
    this.dangerousProtocols = new Set([
      'javascript:', 'data:', 'vbscript:', 'file:', 'about:'
    ]);
  }

  /**
   * Sanitize HTML string to prevent XSS
   * @param {string} html - HTML string to sanitize
   * @param {Object} options - Sanitization options
   * @returns {string} Sanitized HTML
   */
  sanitize(html, options = {}) {
    if (typeof html !== 'string') {
      return '';
    }

    // Create a temporary DOM element for parsing
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;

    // Recursively sanitize all nodes
    this.sanitizeNode(tempDiv, options);

    return tempDiv.innerHTML;
  }

  /**
   * Sanitize a DOM node recursively
   * @param {Node} node - Node to sanitize
   * @param {Object} options - Sanitization options
   */
  sanitizeNode(node, options = {}) {
    const nodesToRemove = [];

    // Process all child nodes
    for (let i = 0; i < node.childNodes.length; i++) {
      const child = node.childNodes[i];

      if (child.nodeType === Node.ELEMENT_NODE) {
        const tagName = child.tagName.toLowerCase();

        // Check if tag is allowed
        if (!this.allowedTags.has(tagName)) {
          nodesToRemove.push(child);
          continue;
        }

        // Sanitize attributes
        this.sanitizeAttributes(child);

        // Recursively sanitize child nodes
        this.sanitizeNode(child, options);
      } else if (child.nodeType === Node.TEXT_NODE) {
        // Text nodes are safe, but we can optionally process them
        if (options.processText) {
          child.textContent = this.sanitizeText(child.textContent);
        }
      } else {
        // Remove other node types (comments, etc.)
        nodesToRemove.push(child);
      }
    }

    // Remove dangerous nodes
    nodesToRemove.forEach(nodeToRemove => {
      node.removeChild(nodeToRemove);
    });
  }

  /**
   * Sanitize element attributes
   * @param {Element} element - Element to sanitize
   */
  sanitizeAttributes(element) {
    const tagName = element.tagName.toLowerCase();
    const allowedForTag = this.allowedAttributes.get(tagName) || new Set();
    const globalAllowed = this.allowedAttributes.get('*') || new Set();
    const attributesToRemove = [];

    // Check all attributes
    for (let i = 0; i < element.attributes.length; i++) {
      const attr = element.attributes[i];
      const attrName = attr.name.toLowerCase();

      // Check if attribute is allowed
      if (!allowedForTag.has(attrName) && !globalAllowed.has(attrName)) {
        attributesToRemove.push(attrName);
        continue;
      }

      // Sanitize attribute values
      if (attrName === 'href' || attrName === 'src') {
        const value = attr.value.toLowerCase().trim();
        const isDangerous = this.dangerousProtocols.some(protocol =>
          value.startsWith(protocol)
        );

        if (isDangerous) {
          attributesToRemove.push(attrName);
        }
      }

      // Sanitize style attribute
      if (attrName === 'style') {
        element.setAttribute('style', this.sanitizeStyle(attr.value));
      }
    }

    // Remove dangerous attributes
    attributesToRemove.forEach(attrName => {
      element.removeAttribute(attrName);
    });
  }

  /**
   * Sanitize CSS style string
   * @param {string} style - CSS style string
   * @returns {string} Sanitized style
   */
  sanitizeStyle(style) {
    if (typeof style !== 'string') {
      return '';
    }

    // Remove dangerous CSS properties and values
    const dangerousPatterns = [
      /expression\s*\(/gi,
      /javascript\s*:/gi,
      /vbscript\s*:/gi,
      /data\s*:/gi,
      /import\s*['"]/gi,
      /@import/gi,
      /binding\s*:/gi,
      /behavior\s*:/gi
    ];

    let sanitizedStyle = style;
    dangerousPatterns.forEach(pattern => {
      sanitizedStyle = sanitizedStyle.replace(pattern, '');
    });

    return sanitizedStyle;
  }

  /**
   * Sanitize text content
   * @param {string} text - Text to sanitize
   * @returns {string} Sanitized text
   */
  sanitizeText(text) {
    if (typeof text !== 'string') {
      return '';
    }

    // Remove null bytes and other dangerous characters
    return text.replace(/\0/g, '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  }
}

/**
 * Safe DOM manipulation utilities
 */
class SafeDOM {
  constructor() {
    this.sanitizer = new HTMLSanitizer();
  }

  /**
   * Safely set innerHTML with sanitization
   * @param {Element} element - Target element
   * @param {string} html - HTML content to set
   * @param {Object} options - Sanitization options
   */
  setInnerHTML(element, html, options = {}) {
    if (!element || typeof html !== 'string') {
      return;
    }

    const sanitizedHTML = this.sanitizer.sanitize(html, options);
    element.innerHTML = sanitizedHTML;
  }

  /**
   * Safely set text content (always safe)
   * @param {Element} element - Target element
   * @param {string} text - Text content to set
   */
  setTextContent(element, text) {
    if (!element) {
      return;
    }

    element.textContent = String(text || '');
  }

  /**
   * Create element with safe content
   * @param {string} tagName - Tag name
   * @param {Object} attributes - Element attributes
   * @param {string} content - Element content
   * @param {boolean} isHTML - Whether content is HTML (will be sanitized)
   * @returns {Element} Created element
   */
  createElement(tagName, attributes = {}, content = '', isHTML = false) {
    const element = document.createElement(tagName);

    // Set attributes safely
    Object.entries(attributes).forEach(([key, value]) => {
      if (typeof value === 'string' || typeof value === 'number') {
        element.setAttribute(key, String(value));
      }
    });

    // Set content safely
    if (content) {
      if (isHTML) {
        this.setInnerHTML(element, content);
      } else {
        this.setTextContent(element, content);
      }
    }

    return element;
  }

  /**
   * Safely append HTML to an element
   * @param {Element} element - Target element
   * @param {string} html - HTML to append
   */
  appendHTML(element, html) {
    if (!element || typeof html !== 'string') {
      return;
    }

    const tempDiv = document.createElement('div');
    this.setInnerHTML(tempDiv, html);

    // Move all child nodes to target element
    while (tempDiv.firstChild) {
      element.appendChild(tempDiv.firstChild);
    }
  }
}

// Create singleton instances
const htmlSanitizer = new HTMLSanitizer();
const safeDOM = new SafeDOM();

// Export for ES6 modules
export { HTMLSanitizer, SafeDOM, htmlSanitizer, safeDOM };

// Export for CommonJS (Node.js style)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { HTMLSanitizer, SafeDOM, htmlSanitizer, safeDOM };
}

// Global browser export
if (typeof window !== 'undefined') {
  window.PromptShieldsXSSProtection = { HTMLSanitizer, SafeDOM, htmlSanitizer, safeDOM };
}

