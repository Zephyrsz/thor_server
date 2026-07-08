# Product

## Register
product

## Users
People running a realtime voice assistant against a remote speech-to-speech server. They need to connect to a configurable websocket endpoint, talk naturally, and inspect live transcription plus conversation history.

## Product Purpose
Provide a focused browser UI for the remote `speech-to-speech` realtime service. The page should make it easy to connect to a websocket URL, stream microphone audio, watch live transcript updates, and review the final turn history.

## Brand Personality
Polished, technical, calm.

## Anti-references
Marketing landing pages, toy demos with oversized hero art, and cluttered chat shells that hide the connection state or transcript stream.

## Design Principles
- Show connection state and endpoint clearly.
- Keep the voice loop visible: live transcript, current turn, and history.
- Make the server URL editable without forcing a rebuild.
- Treat controls as an operator surface, not a consumer app.
- Prefer concise, high-signal feedback over decorative chrome.

## Accessibility & Inclusion
Target WCAG 2.1 AA. Keep contrast strong, support keyboard operation, expose clear focus states, and avoid motion that obscures state changes.
