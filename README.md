# Tactical Scenario Maker

Éditeur et moteur d'exécution de scénarios tactiques multi-agents (surface/air), basé sur de la planification hiérarchique de tâches (HTN) et connecté au simulateur **[LOTUSim](https://github.com/naval-group/LOTUSim)** de Naval Group via ROS 2.

## Fonctionnalités

- **Interface web** (`app.py`) pour créer, éditer et lancer des scénarios sans écrire de code
- **Planification HTN** avec [GTPyhop](https://github.com/dananau/GTPyhop) : chaque agent décompose sa mission (`veiller`, `suivre_agent`, `intercepter`, `rentrer_a_la_base`, ...) en sous-tâches selon des préconditions et une base de connaissances éditable
- **Exécution événementielle** (`main.py`) : chaque agent replanifie uniquement quand la position d'un agent qu'il surveille change réellement (pas de polling), avec un timeout de sécurité en filet de rappel
- **Connexion à LOTUSim** via ROS 2 : spawn des véhicules, envoi de waypoints, réception des positions (`/lotusim/poses`)
- **Générateur de scénarios par IA** (`bdd/ai_scenario_generator.py`) : décrit une mission en langage naturel, un LLM local (Ollama) génère le scénario JSON correspondant et enrichit la base de connaissances — voir [AI_GENERATOR_README.md](AI_GENERATOR_README.md)
- **Visualisation** (`visualize.py`) : génère une carte HTML interactive des trajectoires et waypoints à partir des logs

## Architecture du projet

```
app.py                      # Interface web (éditeur de scénarios + base de connaissances)
main.py                     # Exécution des scénarios : boucle HTN événementielle + pont ROS2/LOTUSim
gtpyhop.py                  # Moteur de planification HTN (GTPyhop, Univ. of Maryland)
visualize.py                # Génération de cartes de trajectoires à partir des logs

bdd/
  tasks_methods.py          # Tâches, méthodes HTN et résolution des cibles (__intruder__, __base__, ...)
  primitives_actions.py     # Actions primitives (déplacement, création d'agent) + commandes ROS2
  knowledge_base.json       # Base de connaissances HTN (tâches/méthodes/préconditions), éditable via l'UI
  ai_scenario_generator.py  # Génération de scénarios via LLM (Ollama)
  utils.py                  # Fonctions utilitaires (conditions d'agent, zones, ...)

scenarios/                  # Scénarios d'exemple (définition des agents, positions, missions)
templates/index.html        # Front-end de l'interface web
tests/                      # Tests unitaires
logs/                       # Logs de poses/waypoints générés à l'exécution
```

## Prérequis

- Python 3
- [ROS 2](https://docs.ros.org/) et les messages/services de [LOTUSim](https://github.com/naval-group/LOTUSim) (`lotusim_msgs`, `geographic_msgs`) — nécessaires uniquement pour exécuter un scénario contre le simulateur (`main.py`)
- [Ollama](https://ollama.ai) (optionnel) — pour le générateur de scénarios par IA

## Installation

```bash
git clone https://github.com/CarlaBarde/tactical_scenario_maker.git
cd tactical_scenario_maker
```

Aucune dépendance externe n'est requise pour l'éditeur web (`app.py`) : il repose uniquement sur la bibliothèque standard Python.

Pour le générateur IA, voir [AI_GENERATOR_README.md](AI_GENERATOR_README.md) (installation d'Ollama via `INSTALL_OLLAMA.sh`).

## Utilisation

### Éditeur de scénarios (interface web)

```bash
python3 app.py
```

Ouvrir [http://localhost:8080](http://localhost:8080) pour créer/éditer des scénarios, ajuster la base de connaissances HTN et prévisualiser les plans calculés pour chaque agent.

### Exécution d'un scénario contre LOTUSim

Nécessite un environnement ROS 2 avec [LOTUSim](https://github.com/naval-group/LOTUSim) démarré :

```bash
python3 main.py <nom_du_scenario>
```

Les scénarios disponibles se trouvent dans `scenarios/` (sans l'extension `.py`).

### Visualisation des trajectoires

```bash
python3 visualize.py logs/poses.csv logs/waypoints.csv
```

### Tests

```bash
python3 -m unittest discover tests
```

## Base de connaissances HTN

Les tâches, méthodes et préconditions sont stockées dans `bdd/knowledge_base.json` et éditables directement depuis l'onglet **Connaissances HTN** de l'interface web. Des tokens comme `__intruder__`, `__base__`, `__drone__` ou `__any__` sont résolus dynamiquement à l'exécution vers l'agent concerné (voir `bdd/tasks_methods.py`).

## Crédits

- Moteur de planification HTN : [GTPyhop](https://github.com/dananau/GTPyhop) (Dana Nau, University of Maryland, BSD-3-Clause-Clear)
- Simulateur naval : [LOTUSim](https://github.com/naval-group/LOTUSim) (Naval Group)
