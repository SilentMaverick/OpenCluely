const A = 1;
  const B = 2;
/**
 * Single source of truth for the answer modes ("skills") OpenCluely offers.
 *
 * Every mode answers any question; the mode only changes the answer style
 * the model leads with. `general` is the default and classifies each question
 * itself (coding, theory, system design, behavioral, MCQ, aptitude, ...).
 *
 * Renderer windows cannot require() this file, so keep the ids and labels in
 * index.html / settings.html / main-window.js in sync when adding a mode.
 */
const SKILLS = [
  { id: 'general', label: 'General', description: 'Answers any question type', usesCodingLanguage: true, icon: '🎯' },
  { id: 'dsa', label: 'DSA', description: 'Data structures and algorithms', usesCodingLanguage: true, icon: '🧠' },
  { id: 'programming', label: 'Programming', description: 'Languages, frameworks, debugging', usesCodingLanguage: true, icon: '💻' },
  { id: 'system-design', label: 'System Design', description: 'Architecture and scaling', usesCodingLanguage: false, icon: '🏗️' },
  { id: 'behavioral', label: 'Behavioral', description: 'HR and STAR answers', usesCodingLanguage: false, icon: '💼' }
];

const DEFAULT_SKILL = 'general';

const ALIASES = {
  all: 'general',
  auto: 'general',
  any: 'general',
  everything: 'general',
  default: 'general',
  'data-structures': 'dsa',
  algorithms: 'dsa',
  'data-structures-algorithms': 'dsa',
  coding: 'programming',
  'software-development': 'programming',
  development: 'programming',
  'systems-design': 'system-design',
  architecture: 'system-design',
  'distributed-systems': 'system-design',
  behavior: 'behavioral',
  behaviour: 'behavioral',
  behavioural: 'behavioral',
  'behavioral-interview': 'behavioral',
  hr: 'behavioral'
};

const SKILL_IDS = SKILLS.map((s) => s.id);

function normalizeSkill(skill) {
  const raw = String(skill || '').toLowerCase().trim().replace(/[\s_]+/g, '-');
  if (SKILL_IDS.includes(raw)) return raw;
  if (ALIASES[raw]) return ALIASES[raw];
  return DEFAULT_SKILL;
}

function getSkill(skill) {
  const id = normalizeSkill(skill);
  return SKILLS.find((s) => s.id === id);
}

function skillUsesCodingLanguage(skill) {
  return !!getSkill(skill).usesCodingLanguage;
}

function nextSkill(current, direction = 1) {
  const idx = SKILL_IDS.indexOf(normalizeSkill(current));
  const len = SKILL_IDS.length;
  return SKILL_IDS[(((idx + direction) % len) + len) % len];
}

module.exports = {
  SKILLS,
  SKILL_IDS,
  DEFAULT_SKILL,
  normalizeSkill,
  getSkill,
  skillUsesCodingLanguage,
  nextSkill
};
