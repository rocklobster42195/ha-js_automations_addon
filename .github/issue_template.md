---
name: Bug report / Feature request
about: Report a bug or suggest a new feature
title: ''
labels: ''
assignees: ''

---

**Is this a bug report or a feature request?**
<!-- Please choose one -->
- [ ] Bug report
- [ ] Feature request

**Describe the bug or feature**
<!-- A clear and concise description of the bug or the feature you are proposing. -->

**Steps to Reproduce (for bugs)**
<!-- 
Steps to reproduce the behavior:
1. Go to '...'
2. Click on '....'
3. Scroll to '....'
4. See error
-->

**Expected behavior**
<!-- A clear and concise description of what you expected to happen. -->

**Screenshots (optional)**
<!-- If applicable, add screenshots to help explain your problem. -->

**Environment:**
 - Add-on Version: <!-- e.g. v1.0.0 -->
 - Integration Version: <!-- e.g. v1.0.0 -->
 - Home Assistant Version: <!-- e.g. 2024.3.0 -->

**Logs**
<!-- 
Please provide relevant log excerpts from the add-on.
You can find them in the "Logs" tab of the add-on.
-->

---

### **Important Note: Home Assistant Integration**

For this add-on to function correctly and allow you to create and control native Home Assistant entities (like `binary_sensor`, `switch`, `light`, etc.) directly from your JavaScript automations, you must install the **"JS Automations" Integration**.

**How to install the Integration:**
1.  Go to the "Settings" tab within the JS Automations Add-on UI.
2.  Follow the instructions there to install the integration.
3.  **Restart Home Assistant** after the installation is complete.

Without this integration, the add-on will operate in a **legacy mode**. In legacy mode, entities are not "boot-safe," meaning they might not persist correctly after a restart of Home Assistant.
