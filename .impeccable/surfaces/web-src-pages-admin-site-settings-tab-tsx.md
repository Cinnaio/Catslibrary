# 站点设置

Mode: Operate. Extend the existing warm-paper admin system, not a new visual identity.

Approved scope: platform operations → site settings → branding / security. Keep content safety policy under moderation. Reuse AdminPage, AdminFormField, admin-panel-card, shared buttons/inputs and semantic color tokens. Desktop groups the editable form and supporting preview/test side by side; mobile stacks them without page overflow.

Branding: exact draft preview, explicit saved/unsaved state, image changes apply immediately while preserving unsaved text. Retain the approved flower footer and login artwork; branding configuration must not repaint them.

Security: distinguish public site key, private secret and allowed hostnames. Show per-field configuration source and disable environment-controlled fields. Never echo the saved secret. Explain encryption readiness and verification failure in plain Chinese. Testing uses saved settings and does not grant adult access.

Acceptance: keyboard form submission, server errors retain drafts, bounded upload validation, usable 320px and 390px layouts, light/dark semantic styling, no decorative motion or bespoke nested panels.
