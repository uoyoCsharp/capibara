# Capibara UX Redesign Proposal: Organization Flow & Onboarding

**Author:** uoyo (Facilitated by Sally, UX Designer)
**Date:** 2026-04-12
**Status:** Draft for Review

---

## 1. Executive Summary & Design Objective

The current UI/UX design of Capibara heavily exposes the concept of "Organizations," which forces users to constantly think about system architecture rather than their actual tasks. The objective of this redesign is to **shift the mental model from a system-centric "Organization Management" view to a user-centric "Immersive Workspace" view.**

By hiding complex structural concepts and introducing a guided First-Time User Experience (FTUE), we aim to massively reduce cognitive load, simplify the navigation, and help new users achieve their "Aha!" moment much faster.

---

## 2. Core UX Principles for this Redesign

1. **De-emphasize System Structure:** Once a user is inside a workspace (organization), they should feel completely immersed. The concept of "switching organizations" should be hidden away from the primary interaction paths.
2. **Progressive Disclosure:** Do not overwhelm the user with configurations on Day 1. Guide them step-by-step.
3. **Empathetic Onboarding:** Turn sterile system requirements (like checking for CLI tools) into a seamless, tech-forward, and reassuring health-check experience.

---

## 3. Proposed Journey 1: First-Time User Experience (Onboarding Wizard)

Instead of dropping the user into a complex dashboard or a dry "Create Organization" form, we will introduce an immersive, full-screen Onboarding Wizard.

### Step 1: Environment Health Check
* **UX Strategy:** Turn a technical prerequisite into a reassuring system check.
* **UI Elements:** 
  * A visually appealing "System Scanning" animation.
  * Clear status indicators for dependencies.
  * **Claude Code Detection:** If installed, show a glowing green checkmark ✅. If missing, show a friendly warning with a "One-Click Copy Install Command" snippet and a visual mini-guide, completely avoiding any dead-end error states.

### Step 2: Naming the Space
* **UX Strategy:** Shift the terminology from "Create an Organization" to something more personal and action-oriented like "Name your AI Workspace" or "What are we building today?".
* **UI Elements:** A single, large, centered input field with an inspiring placeholder (e.g., "Acme Corp Next-Gen MVP").

### Step 3: Template Discovery & Selection
* **UX Strategy:** Help the user avoid the "blank canvas paralysis" by offering curated starting points.
* **UI Elements:** 
  * Visually distinct **Template Cards** (e.g., Agile Development, Lightweight QA, Single-Agent Scripting).
  * Each card features an illustrative icon/graphic, a short storytelling description, and tags showing the involved AI roles.
  * "Recommended" badges on popular templates to guide uncertain users.

### Step 4: The "Magic Moment" (Generation)
* **UX Strategy:** Mask the backend provisioning time with a delightful and dynamic loading state.
* **UI Elements:** Instead of a generic spinner, show dynamic text emphasizing the value being created: *"Recruiting AI Developer...", "Configuring Workflow Engine...", "Preparing your Workspace..."* before launching them directly into the clean dashboard.

---

## 4. Proposed Journey 2: Core Workspace Experience (De-organization)

### Immediate UI Changes
* **Remove Global Switchers:** Eliminate the persistent "Organization Switcher" dropdowns or tabs from the top navigation bar or primary left sidebar. 
* **Focus on the "Now":** The primary navigation should strictly focus on actionable items within the current context: Task Trees, Approvals, Agent Chats, and Code Views.

### Relocation of Organization Management
* **Profile / Settings Menu:** Move the ability to switch, create, or manage organizations into a secondary menu. 
* **Interaction:** The user clicks their Avatar (bottom left or top right) -> A popover menu appears -> "Switch Workspace / Organization" is listed alongside "User Settings" and "Log Out".

### Aesthetic Shift
* The workspace should feel like a unified, uninterrupted flow. Data, tasks, and agents are implicitly scoped to the current active organization without constantly reminding the user of the boundary. 
