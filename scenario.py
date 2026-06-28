# scenario.py — généré par LOTUSim App
# Modifiable directement.

NOM = 'interception_sous_marin'

AGENTS = [{'dispo': 1, 'modele': 'fremm', 'nom': 'fremm1', 'vitesse': 8, 'x': 0, 'y': 0},
 {'dispo': 1,
  'modele': 'lrauv',
  'nom': 'lrauv1',
  'vitesse': 3,
  'x': 510,
  'y': 200}]

ZONES = {'zone_alpha': {'waypoints': [[0, 0], [500, 0], [500, 500], [0, 500]]}}

BUTS_PAR_AGENT = {'fremm1': [['patrouiller', 'fremm1', 'zone_alpha']],
 'lrauv1': [['naviguer_vers_point', 'lrauv1', -500, 250]]}

EVENEMENTS = [{'alors': {'agent': 'fremm1', 'but': ['suivre_agent', 'fremm1', 'cible']},
  'nom': 'intrusion_detectee',
  'quand': [['distance', 'fremm1', 'inferieur', 600, 'cible'],
            ['modele', 'cible', 'egal', 'lrauv']],
  'rearmable': False}]
