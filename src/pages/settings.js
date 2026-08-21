/**
 * Settings Page Script - Suggestion Types Management
 * Ports the logic from macOS SuggestionTypeListView and SuggestionTypeEditorView
 */

import { CommunicationService } from '../services/communicationService.js';
import { MessageTypes } from '../config/messageTypes.js';

const TEXT_PLACEHOLDER = '{{TEXT}}';
const CATEGORY_ORDER = [
  'Writing Clarity',
  'Structure & Adaptation',
  'Security & Compliance',
  'Custom'
];

class SettingsManager {
  constructor() {
    this.communication = new CommunicationService();
    this.suggestionTypes = [];
    this.editingSuggestionType = null;
    this.init();
  }

  init() {
    this.setupEventListeners();
    this.setupMessageListeners();
    this.loadSuggestionTypes();
  }

  setupEventListeners() {
    // Header buttons
    document.getElementById('addTypeBtn').addEventListener('click', () => this.openEditor());

    // Empty state buttons
    document.getElementById('emptyAddBtn')?.addEventListener('click', () => this.openEditor());
    document.getElementById('emptyResetBtn')?.addEventListener('click', () => this.showResetModal());

    // Footer buttons
    document.getElementById('resetBtn')?.addEventListener('click', () => this.showResetModal());
    document.getElementById('retryBtn')?.addEventListener('click', () => this.loadSuggestionTypes());

    // Editor modal
    document.getElementById('closeModalBtn')?.addEventListener('click', () => this.closeEditor());
    document.getElementById('cancelBtn')?.addEventListener('click', () => this.closeEditor());
    document.getElementById('saveBtn')?.addEventListener('click', () => this.saveSuggestionType());
    document.getElementById('deleteTypeBtn')?.addEventListener('click', () => this.showDeleteModal());

    // Form inputs
    document.getElementById('nameInput')?.addEventListener('input', () => this.validateForm());
    document.getElementById('promptTemplateInput')?.addEventListener('input', () => this.handlePromptTemplateChange());
    document.getElementById('insertPlaceholderBtn')?.addEventListener('click', () => this.insertPlaceholder());

    // Sort order controls
    document.getElementById('sortOrderDecrease')?.addEventListener('click', () => this.adjustSortOrder(-1));
    document.getElementById('sortOrderIncrease')?.addEventListener('click', () => this.adjustSortOrder(1));

    // Reset modal
    document.querySelectorAll('.reset-close').forEach(btn => {
      btn.addEventListener('click', () => this.hideResetModal());
    });
    document.getElementById('confirmResetBtn')?.addEventListener('click', () => this.resetSuggestionTypes());

    // Delete modal
    document.querySelectorAll('.delete-close').forEach(btn => {
      btn.addEventListener('click', () => this.hideDeleteModal());
    });
    document.getElementById('confirmDeleteBtn')?.addEventListener('click', () => this.deleteSuggestionType());

    // Modal backdrop clicks
    document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
      backdrop.addEventListener('click', (e) => {
        const modal = e.target.closest('.modal');
        if (modal.id === 'editorModal') this.closeEditor();
        if (modal.id === 'resetModal') this.hideResetModal();
        if (modal.id === 'deleteModal') this.hideDeleteModal();
      });
    });
  }

  setupMessageListeners() {
    this.communication.addMessageListener(MessageTypes.SUGGESTION_TYPES_UPDATED, (response) => {
      if (response.suggestionTypes) {
        this.suggestionTypes = response.suggestionTypes;
        this.renderSuggestionTypes();
      }
    });
  }

  async loadSuggestionTypes() {
    this.showLoading();

    try {
      const types = await this.communication.fetchSuggestionTypes();
      this.suggestionTypes = types;
      this.renderSuggestionTypes();
    } catch (error) {
      console.error('Failed to load suggestion types:', error);
      this.showError(error.message || 'Failed to load suggestion types');
    }
  }

  renderSuggestionTypes() {
    const listContainer = document.getElementById('suggestionTypesList');
    const loadingState = document.getElementById('loadingState');
    const errorState = document.getElementById('errorState');
    const emptyState = document.getElementById('emptyState');
    const footer = document.getElementById('footer');

    loadingState.classList.add('hidden');
    errorState.classList.add('hidden');

    if (this.suggestionTypes.length === 0) {
      listContainer.classList.add('hidden');
      emptyState.classList.remove('hidden');
      footer.classList.add('hidden');
      return;
    }

    emptyState.classList.add('hidden');
    listContainer.classList.remove('hidden');
    footer.classList.remove('hidden');

    // Group by category
    const grouped = this.groupByCategory(this.suggestionTypes);
    const sortedCategories = this.getSortedCategories(Object.keys(grouped));

    let html = '';
    for (const category of sortedCategories) {
      const types = grouped[category];
      html += this.renderCategory(category, types);
    }

    listContainer.innerHTML = html;
    this.attachRowEventListeners();
    this.updateStats();
  }

  groupByCategory(types) {
    const grouped = {};
    types.forEach(type => {
      const category = type.category || 'Custom';
      if (!grouped[category]) {
        grouped[category] = [];
      }
      grouped[category].push(type);
    });

    // Sort each category's types by sortOrder
    Object.keys(grouped).forEach(category => {
      grouped[category].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    });

    return grouped;
  }

  getSortedCategories(categories) {
    return categories.sort((a, b) => {
      const aIndex = CATEGORY_ORDER.indexOf(a);
      const bIndex = CATEGORY_ORDER.indexOf(b);
      const aOrder = aIndex >= 0 ? aIndex : Number.MAX_SAFE_INTEGER;
      const bOrder = bIndex >= 0 ? bIndex : Number.MAX_SAFE_INTEGER;
      return aOrder - bOrder;
    });
  }

  getCategoryDisplayName(category) {
    return `${category}`;
  }

  renderCategory(category, types) {
    const typesHtml = types.map(type => this.renderTypeRow(type)).join('');
    return `
      <div class="category-section">
        <div class="category-header">${this.getCategoryDisplayName(category)}</div>
        <div class="category-items">
          ${typesHtml}
        </div>
      </div>
    `;
  }

  renderTypeRow(type) {
    const isEnabled = type.is_enabled !== undefined ? type.is_enabled : true;
    const isDefault = type.is_default || false;

    return `
      <div class="suggestion-type-row" data-id="${type.id}">
        <div class="type-info">
          <div class="type-name">
            <span>${this.escapeHtml(type.name)}</span>
            ${isDefault ? '<span class="default-badge">Default</span>' : ''}
          </div>
          ${type.description ? `<div class="type-description">${this.escapeHtml(type.description)}</div>` : ''}
        </div>
        <div class="type-actions">
          <label class="toggle">
            <input type="checkbox" class="toggle-enabled" data-id="${type.id}" ${isEnabled ? 'checked' : ''}>
            <span class="toggle-slider"></span>
          </label>
          <button class="edit-btn" data-id="${type.id}" title="Edit">✏️</button>
        </div>
      </div>
    `;
  }

  attachRowEventListeners() {
    // Toggle switches
    document.querySelectorAll('.toggle-enabled').forEach(toggle => {
      toggle.addEventListener('change', async (e) => {
        const id = e.target.dataset.id;
        const isEnabled = e.target.checked;
        await this.toggleSuggestionType(id, isEnabled);
      });
    });

    // Edit buttons
    document.querySelectorAll('.edit-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.target.dataset.id;
        const type = this.suggestionTypes.find(t => t.id === id);
        if (type) {
          this.openEditor(type);
        }
      });
    });
  }

  updateStats() {
    const total = this.suggestionTypes.length;
    const enabled = this.suggestionTypes.filter(t => t.is_enabled !== false).length;
    document.getElementById('statsText').textContent = `${total} types • ${enabled} enabled`;
  }

  // Editor Methods
  openEditor(suggestionType = null) {
    this.editingSuggestionType = suggestionType;

    const modal = document.getElementById('editorModal');
    const title = document.getElementById('editorTitle');
    const deleteSection = document.getElementById('deleteSection');
    const saveBtn = document.getElementById('saveBtn');

    // Set title and button text
    if (suggestionType) {
      title.textContent = 'Edit Suggestion Type';
      saveBtn.textContent = 'Save Changes';
      deleteSection.classList.remove('hidden');
    } else {
      title.textContent = 'New Suggestion Type';
      saveBtn.textContent = 'Create';
      deleteSection.classList.add('hidden');
    }

    // Populate form
    this.populateForm(suggestionType);

    // Show modal
    modal.classList.remove('hidden');
    document.getElementById('nameInput').focus();
  }

  closeEditor() {
    const modal = document.getElementById('editorModal');
    modal.classList.add('hidden');
    this.editingSuggestionType = null;
    this.clearForm();
  }

  populateForm(suggestionType) {
    document.getElementById('nameInput').value = suggestionType?.name || '';
    document.getElementById('descriptionInput').value = suggestionType?.description || '';
    document.getElementById('promptTemplateInput').value = suggestionType?.prompt_template || '';
    document.getElementById('enabledToggle').checked = suggestionType?.is_enabled !== false;
    document.getElementById('sortOrderInput').value = suggestionType?.sort_order || 99;

    this.handlePromptTemplateChange();
    this.validateForm();
  }

  clearForm() {
    document.getElementById('nameInput').value = '';
    document.getElementById('descriptionInput').value = '';
    document.getElementById('promptTemplateInput').value = '';
    document.getElementById('enabledToggle').checked = true;
    document.getElementById('sortOrderInput').value = 99;
    document.getElementById('editorError').classList.add('hidden');

    this.handlePromptTemplateChange();
  }

  handlePromptTemplateChange() {
    const textarea = document.getElementById('promptTemplateInput');
    const charCount = document.getElementById('charCount');
    const placeholderStatus = document.getElementById('placeholderStatus');
    const placeholderWarning = document.getElementById('placeholderWarning');
    const insertBtn = document.getElementById('insertPlaceholderBtn');

    const text = textarea.value;
    const hasPlaceholder = text.includes(TEXT_PLACEHOLDER);

    // Update char count
    charCount.textContent = text.length;
    charCount.parentElement.classList.toggle('warning', text.length > 4000);
    charCount.parentElement.classList.toggle('error', text.length > 5000);

    // Update placeholder status
    placeholderStatus.classList.toggle('hidden', !hasPlaceholder);
    placeholderWarning.classList.toggle('hidden', hasPlaceholder || text.length === 0);
    insertBtn.disabled = hasPlaceholder;
    insertBtn.classList.toggle('btn-secondary', !hasPlaceholder);
    insertBtn.style.opacity = hasPlaceholder ? '0.5' : '1';

    this.validateForm();
  }

  insertPlaceholder() {
    const textarea = document.getElementById('promptTemplateInput');
    const text = textarea.value;

    if (!text.includes(TEXT_PLACEHOLDER)) {
      if (text.length === 0) {
        textarea.value = TEXT_PLACEHOLDER;
      } else {
        textarea.value = `${text  }\n\n${  TEXT_PLACEHOLDER}`;
      }
      this.handlePromptTemplateChange();
    }
  }

  adjustSortOrder(delta) {
    const input = document.getElementById('sortOrderInput');
    let value = parseInt(input.value) || 0;
    value = Math.max(0, Math.min(999, value + delta));
    input.value = value;
  }

  validateForm() {
    const name = document.getElementById('nameInput').value.trim();
    const promptTemplate = document.getElementById('promptTemplateInput').value.trim();

    const isValid = name.length > 0 &&
                    promptTemplate.length > 0 &&
                    promptTemplate.length <= 5000;

    document.getElementById('saveBtn').disabled = !isValid;
    return isValid;
  }

  generateUUID() {
    const bytes = crypto.getRandomValues(new Uint8Array(16));

    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');

    return `${hex.substr(0,8)}-${hex.substr(8,4)}-${hex.substr(12,4)}-${hex.substr(16,4)}-${hex.substr(20)}`;
  }

  async saveSuggestionType() {
    if (!this.validateForm()) return;

    const saveBtn = document.getElementById('saveBtn');
    const originalText = saveBtn.textContent;
    saveBtn.textContent = 'Saving...';
    saveBtn.disabled = true;

    const profile = await this.communication.getProfile()

    try {
      const suggestionType = {
        id: this.editingSuggestionType?.id,
        type_key: this.editingSuggestionType?.type_key ?? this.generateUUID(),
        name: document.getElementById('nameInput').value.trim(),
        description: document.getElementById('descriptionInput').value.trim(),
        category: 'Custom',
        prompt_template: document.getElementById('promptTemplateInput').value,
        is_enabled: document.getElementById('enabledToggle').checked,
        sort_order: parseInt(document.getElementById('sortOrderInput').value) || 99,
        suggestion_type_group_id: this.editingSuggestionType?.suggestion_type_group_id ?? profile.default_suggestion_type_group_id
      };

      if (this.editingSuggestionType) {
        await this.communication.updateSuggestionType(suggestionType);
        this.showToast('Suggestion type updated successfully', 'success');
      } else {
        await this.communication.createSuggestionType(suggestionType);
        this.showToast('Suggestion type created successfully', 'success');
      }

      this.closeEditor();
      await this.loadSuggestionTypes();
    } catch (error) {
      console.error('Failed to save suggestion type:', error);
      document.getElementById('editorError').textContent = error.message || 'Failed to save';
      document.getElementById('editorError').classList.remove('hidden');
    } finally {
      saveBtn.textContent = originalText;
      saveBtn.disabled = false;
    }
  }

  async toggleSuggestionType(id, isEnabled) {
    try {
      const type = this.suggestionTypes.find(t => t.id === id);
      if (type) {
        await this.communication.toggleSuggestionType(type, isEnabled);

        // Update local state
        const index = this.suggestionTypes.findIndex(t => t.id === id);
        if (index >= 0) {
          this.suggestionTypes[index].is_enabled = isEnabled;
        }
        this.updateStats();
      }
    } catch (error) {
      console.error('Failed to toggle suggestion type:', error);
      this.showToast('Failed to update suggestion type', 'error');
      // Revert toggle state
      const toggle = document.querySelector(`.toggle-enabled[data-id="${id}"]`);
      if (toggle) {
        toggle.checked = !isEnabled;
      }
    }
  }

  // Delete Methods
  showDeleteModal() {
    document.getElementById('deleteModal').classList.remove('hidden');
  }

  hideDeleteModal() {
    document.getElementById('deleteModal').classList.add('hidden');
  }

  async deleteSuggestionType() {
    if (!this.editingSuggestionType) return;

    const confirmBtn = document.getElementById('confirmDeleteBtn');
    confirmBtn.textContent = 'Deleting...';
    confirmBtn.disabled = true;

    try {
      await this.communication.deleteSuggestionType(this.editingSuggestionType);
      this.showToast('Suggestion type deleted', 'success');
      this.hideDeleteModal();
      this.closeEditor();
      await this.loadSuggestionTypes();
    } catch (error) {
      console.error('Failed to delete suggestion type:', error);
      this.showToast('Failed to delete suggestion type', 'error');
    } finally {
      confirmBtn.textContent = 'Delete';
      confirmBtn.disabled = false;
    }
  }

  // Reset Methods
  showResetModal() {
    document.getElementById('resetModal').classList.remove('hidden');
  }

  hideResetModal() {
    document.getElementById('resetModal').classList.add('hidden');
  }

  async resetSuggestionTypes() {
    const confirmBtn = document.getElementById('confirmResetBtn');
    confirmBtn.textContent = 'Resetting...';
    confirmBtn.disabled = true;

    try {
      const count = await this.communication.resetSuggestionTypes();
      this.showToast(`Reset complete! ${count} default types restored.`, 'success');
      this.hideResetModal();
      await this.loadSuggestionTypes();
    } catch (error) {
      console.error('Failed to reset suggestion types:', error);
      this.showToast('Failed to reset suggestion types', 'error');
    } finally {
      confirmBtn.textContent = 'Reset';
      confirmBtn.disabled = false;
    }
  }

  // UI State Methods
  showLoading() {
    document.getElementById('loadingState').classList.remove('hidden');
    document.getElementById('errorState').classList.add('hidden');
    document.getElementById('emptyState').classList.add('hidden');
    document.getElementById('suggestionTypesList').classList.add('hidden');
    document.getElementById('footer').classList.add('hidden');
  }

  showError(message) {
    document.getElementById('loadingState').classList.add('hidden');
    document.getElementById('errorState').classList.remove('hidden');
    document.getElementById('errorMessage').textContent = message;
    document.getElementById('emptyState').classList.add('hidden');
    document.getElementById('suggestionTypesList').classList.add('hidden');
    document.getElementById('footer').classList.add('hidden');
  }

  showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    const toastMessage = document.getElementById('toastMessage');

    toast.className = 'toast';
    toast.classList.add(type);
    toastMessage.textContent = message;
    toast.classList.remove('hidden');

    setTimeout(() => {
      toast.classList.add('hidden');
    }, 3000);
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    new SettingsManager();
  });
} else {
  new SettingsManager();
}
