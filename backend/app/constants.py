USERNAME_MIN_LENGTH = 4
USERNAME_MAX_LENGTH = 64

PASSWORD_MIN_LENGTH = 8
PASSWORD_MAX_LENGTH = 128
PASSWORD_HASH_MAX_LENGTH = 255

LOGIN_TOKEN_LENGTH = 64
SESSION_TTL_DAYS = 14

PORTAL_NAME_MAX_LENGTH = 128
DESTINATION_WORLD_MAX_LENGTH = 128

STABILITY_INCREASE_RAND_RANGE = (10, 30)

# Portal simulator (app/simulator.py) — background task that keeps the lab "alive".
SIMULATOR_TICK_SECONDS = 10
# Per-tick chance of a new portal opening; 0.05 * 10 s tick = about one portal per 3-4 minutes.
SIMULATOR_OPEN_CHANCE_DEFAULT = 0.05
SIMULATOR_PORTAL_TTL_MIN_SECONDS = 30
SIMULATOR_PORTAL_TTL_MAX_SECONDS = 30 * 60
# Per-tick chance that an open portal is randomly updated (stability / creatures_count).
SIMULATOR_UPDATE_CHANCE = 0.5
SIMULATOR_STABILITY_DELTA = 15
SIMULATOR_CREATURES_DELTA = 5
SIMULATOR_MAX_CREATURES = 100

# Risk factor formula parameters — shared between the Python property in models.py
# and the SQL expressions in routes/portals.py so the two cannot drift apart.
RISK_ENERGY_WEIGHT = 0.2
RISK_STABILITY_WEIGHT = 0.2
RISK_CREATURES_WEIGHT = 0.3
RISK_TTL_WEIGHT = 0.3
RISK_CREATURES_SCALE = 0.1
RISK_TTL_SCALE = 0.04

DANGER_LOW_THRESHOLD = 0.3
DANGER_MEDIUM_THRESHOLD = 0.6
DANGER_HIGH_THRESHOLD = 0.9
