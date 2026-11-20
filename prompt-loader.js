const fs = require('fs');
const path = require('path');
const {
  SKILL_IDS,
  DEFAULT_SKILL,
  normalizeSkill,
  skillUsesCodingLanguage
} = require('./src/core/skills');

const LANGUAGE_TITLES = { cpp: 'C++', c: 'C', python: 'Python', java: 'Java', javascript: 'JavaScript', js: 'JavaScript' };
const FENCE_TAGS = { cpp: 'cpp', c: 'c', python: 'python', java: 'java', javascript: 'javascript', js: 'javascript' };

function describeLanguage(programmingLanguage) {
  const norm = String(programmingLanguage || '').toLowerCase();
  const title = LANGUAGE_TITLES[norm] || (norm ? norm.charAt(0).toUpperCase() + norm.slice(1) : '');
  const fenceTag = FENCE_TAGS[norm] || norm || 'text';
  return { norm, title, fenceTag };
}

class PromptLoader {
  constructor() {
    this.prompts = new Map();
    this.promptsLoaded = false;
  }

  /** Load the prompt file for every registered mode from ./prompts. */
  loadPrompts() {
    if (this.promptsLoaded) {
      return;
    }

    // In packaged builds asar-unpacked files are still reachable through
    // their original path thanks to Electron's fs patching.
    const promptsDir = path.join(__dirname, 'prompts');

    try {
      for (const skill of SKILL_IDS) {
        const filePath = path.join(promptsDir, `${skill}.md`);
        if (fs.existsSync(filePath)) {
          this.prompts.set(skill, fs.readFileSync(filePath, 'utf8'));
        } else {
          console.warn(`Prompt file missing for mode "${skill}": ${filePath}`);
        }
      }
      this.promptsLoaded = true;
    } catch (error) {
      console.error('Error loading skill prompts:', error);
      throw new Error(`Failed to load skill prompts: ${error.message}`);
    }
  }

  /**
   * System prompt for a mode, with the coding language appended for modes
   * that write code.
   */
  getSkillPrompt(skillName, programmingLanguage = null) {
    this.loadPrompts();
    const skill = this.normalizeSkillName(skillName);
    const promptContent = this.prompts.get(skill) || this.prompts.get(DEFAULT_SKILL) || null;
    if (!promptContent) {
      return null;
    }
    if (programmingLanguage && this.requiresProgrammingLanguage(skill)) {
      return this.injectProgrammingLanguage(promptContent, programmingLanguage, skill);
    }
    return promptContent;
  }

  injectProgrammingLanguage(promptContent, programmingLanguage, skillName) {
    const { title, fenceTag } = describeLanguage(programmingLanguage);
    if (!title) return promptContent;

    if (skillName === 'dsa') {
      return `${promptContent}

## IMPLEMENTATION LANGUAGE: ${title.toUpperCase()}
STRICT REQUIREMENTS:
- Write every solution in ${title}. Do not include snippets or alternatives in other languages unless the user asks.
- Code blocks must use the language tag \`\`\`${fenceTag}\`\`\`.
- Aim for the best possible time and space complexity.
- Provide: brief approach, then the final ${title} implementation, then time/space complexity.
- If the input is a problem statement without code, produce a complete, runnable ${title} solution without asking for clarification.`;
    }

    return `${promptContent}

## PREFERRED CODING LANGUAGE: ${title.toUpperCase()}
- When the answer needs program code, write it in ${title} with the tag \`\`\`${fenceTag}\`\`\`, unless the question names a different language or the code is inherently another language (SQL, shell, config, HTML/CSS).
- Do not add code to answers that do not need it.`;
  }

  /** Kept for the legacy (no session manager) request path in llm.service. */
  getRequestComponents(skillName, userMessage, storedMemory, programmingLanguage = null) {
    const skill = this.normalizeSkillName(skillName);
    const skillPrompt = this.getSkillPrompt(skill, programmingLanguage);
    return {
      skillName: skill,
      userMessage,
      skillPrompt,
      shouldUseModelMemory: !!skillPrompt,
      isFirstTime: !storedMemory || storedMemory.length === 0,
      modelMemory: skillPrompt,
      messageContent: userMessage,
      programmingLanguage,
      requiresProgrammingLanguage: this.requiresProgrammingLanguage(skill)
    };
  }

  requiresProgrammingLanguage(skillName) {
    return skillUsesCodingLanguage(skillName);
  }

  getSkillsRequiringProgrammingLanguage() {
    return SKILL_IDS.filter((id) => skillUsesCodingLanguage(id));
  }

  normalizeSkillName(skillName) {
    return normalizeSkill(skillName);
  }

  getAvailableSkills() {
    this.loadPrompts();
    return SKILL_IDS.filter((id) => this.prompts.has(id));
  }

  resetSession() {}

  getSessionStats() {
    this.loadPrompts();
    return {
      totalPrompts: this.prompts.size,
      availableSkills: this.getAvailableSkills(),
      skillsRequiringProgrammingLanguage: this.getSkillsRequiringProgrammingLanguage()
    };
  }
}

const promptLoader = new PromptLoader();

module.exports = {
  PromptLoader,
  promptLoader,
  describeLanguage
};
