# SmartHome Companion Backend (HACS)

[![hacs_badge](https://img.shields.io/badge/HACS-Custom-41BDF5.svg)](https://github.com/hacs/default)
[![Home Assistant](https://img.shields.io/badge/Home%20Assistant-2024.1%2B-blue.svg)](https://www.home-assistant.io/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Backend integration for the **SmartHome Companion** kiosk and dashboard system. It handles autonomous background automation, solar calculations, irrigation control, circadian lighting, and WebSocket communication with zero cloud dependencies.

---

## Key Features

- **Automated Blinds & Solar Shading**
  - Real-time facade solar irradiance calculations (North, East, South, West) based on sun elevation, azimuth, and cloud coverage.
  - Dynamic heat protection scheduling, ventilation mode, sunrise/sunset offsets, and sleep-in protection.
  - Background watchdog with manual override detection.

- **Smart Multi-Zone Irrigation**
  - Supports schedule-based and soil-sensor-driven watering cycles.
  - Weather forecast integration (rain skipping, rain catch-up, and heat wave overrides).
  - Maximum runtime guard and safety timeouts.

- **Circadian Adaptive Lighting**
  - Smooth circadian brightness curves throughout the day.
  - Non-intrusive transitions and automatic manual override detection.

- **Presence Simulation**
  - Coordinates lights and blinds during away/vacation modes to simulate occupancy.

- **Device Management & Label Registry**
  - Seamless Home Assistant label synchronization and custom categorization for frontend display.

- **100% Local & Privacy-Friendly**
  - All calculations run locally on your Home Assistant instance. No external API keys or telemetry required.

---

## Installation

### Option 1: Via HACS (Recommended)

1. Open **HACS** in your Home Assistant sidebar.
2. Click the three dots in the top-right corner and select **Custom repositories**.
3. Enter the repository URL:
   ```text
   https://github.com/MrAhmalo/smarthome-companion-hacs
   ```
4. Select Category: **Integration** and click **Add**.
5. Find **SmartHome Companion Backend**, click **Download**, and restart Home Assistant.

---

### Option 2: Manual Installation

1. Download or clone this repository.
2. Copy the `custom_components/smarthome_companion_hacs` directory into your Home Assistant `/config/custom_components/` folder:
   ```text
   /config/custom_components/smarthome_companion_hacs/
   ```
3. Restart Home Assistant.

---

## Configuration

1. Navigate to **Settings** > **Devices & Services** > **Integrations**.
2. Click **Add Integration** and search for **SmartHome Companion Backend**.
3. Follow the on-screen configuration prompts to select the modules you wish to enable.

---

## Frontend Companion

This integration is designed to pair seamlessly with the **SmartHome Companion** dashboard. Connect your frontend client to Home Assistant via WebSocket to manage your devices, blinds, and irrigation schedules in real time.
