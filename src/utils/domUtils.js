/**
 * Utility functions for DOM manipulation and text extraction
 */
import { safeDOM } from './xssProtection.js';

export class DomUtils {
  /**
   * Get text content from an element
   * @param {HTMLElement} element - Target element
   * @returns {string} Text content
   */
  static getTextContent(element) {
    if (!element) return '';

    if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
      return element.value || '';
    } else if (element.tagName === 'DIV' || element.contentEditable === 'true') {
      return element.textContent || '';
    }

    return '';
  }

  /**
   * Set text content to an element (SECURITY FIX: Now uses safe DOM manipulation)
   * @param {HTMLElement} element - Target element
   * @param {string} text - Text to set
   * @param {boolean} isHTML - Whether text contains HTML (will be sanitized)
   */
  static setTextContent(element, text, isHTML = false) {
    if (!element) return;

    if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
      element.value = String(text || '');
    } else if (element.tagName === 'DIV' || element.contentEditable === 'true') {
      if (isHTML) {
        // Use safe HTML setting with sanitization
        safeDOM.setInnerHTML(element, text);
      } else {
        // Use safe text content setting
        safeDOM.setTextContent(element, text);
      }
    }
  }

  /**
   * Check if an element is a text input
   * @param {HTMLElement} element - Element to check
   * @returns {boolean} True if element is a text input
   */
  static isTextInput(element) {
    if (!element) return false;

    const tagName = element.tagName;

    return (
      tagName === 'INPUT' ||
      tagName === 'TEXTAREA' ||
      (tagName === 'DIV' && element.contentEditable === 'true')
    );
  }

  /**
   * Trigger a change event on an element
   * @param {HTMLElement} element - Target element
   */
  static triggerChangeEvent(element) {
    if (!element) return;

    const changeEvent = new Event('change', {
      bubbles: true,
      cancelable: true
    });
    element.dispatchEvent(changeEvent);
  }

  /**
   * Get the bounding rectangle of an element relative to the viewport
   * @param {HTMLElement} element - Target element
   * @returns {DOMRect} Bounding rectangle
   */
  static getBoundingRect(element) {
    if (!element) return null;
    return element.getBoundingClientRect();
  }

  /**
   * Check if an element is visible in the viewport
   * @param {HTMLElement} element - Element to check
   * @returns {boolean} True if element is visible
   */
  static isElementVisible(element) {
    if (!element) return false;

    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);

    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.visibility !== 'hidden' &&
      style.display !== 'none' &&
      style.opacity !== '0'
    );
  }

  /**
   * Find the closest parent element that matches a selector
   * @param {HTMLElement} element - Starting element
   * @param {string} selector - CSS selector
   * @returns {HTMLElement|null} Matching parent element or null
   */
  static findClosestParent(element, selector) {
    if (!element) return null;

    let current = element;
    while (current && current !== document.body) {
      if (current.matches && current.matches(selector)) {
        return current;
      }
      current = current.parentElement;
    }

    return null;
  }
}
