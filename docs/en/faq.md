# Frequently Asked Questions

### What should I configure first?

Open Settings → Overview first. It lists the required configuration currently blocking production and links directly to the right page. Once the required items are ready, open Quick Production, choose a template, and start a task.

### Do I need to configure every service?

No. Configure only the services used by the template you select. For example, connect an LLM for AI writing and an image service for automatic artwork. Overview separates required items from optional ones.

### What is the difference between “configured” and “connected”?

“Configured” only means that values such as an endpoint or key were saved. It does not prove that the external service is currently reachable. Use a connection test or an actual task result as the source of truth.

### How do I choose an LLM?

Go to Settings → AI Models, add a real service connection, load its models, and save a default model. A template or one-off production setting can override that default when explicitly selected.

### How do I choose an image or video generation service?

Go to Settings → Image & Video Generation and configure the service used by your template. Workflow services and independent image services save separately. You only need the connections you actually use.

### How do I choose the default voice?

Go to Settings → Voice Generation (TTS), choose the default service, then provide the model or voice required by that service. New tasks use this default unless a template explicitly overrides it.

### What should I do when generation fails?

Open the failed task from the workspace and read the explicit error in its current status. Fix network, credential, or service problems on the relevant settings page, then retry the original task instead of creating duplicate content.

### What is the difference between a template and one-off settings?

A template stores long-term defaults. One-off settings in Quick Production affect only the current task. Save repeated adjustments in a template and keep occasional changes in the current run.

### What does editing a prompt affect?

Changes in the Prompt Library affect templates that still reference that prompt. Templates with a saved custom body do not automatically follow later library changes. Check the reference or custom state shown by the editor.

### Are publishing and storage required?

No. Configure them only when you need platform publishing or object storage. Local generation and downloads can work without those connections.

### Where can I find more detailed diagnostics?

For settings issues, open Settings → Overview → Advanced & Diagnostics. For production issues, open the task in the workspace and inspect the most recent failed stage in its timeline.
