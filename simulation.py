"""
simulation.py — Logique HTN, simulateur cinématique, boucle d'exécution.
"""

import sys, os, math, time, threading, importlib, inspect

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'HTN'))

import HTN.gtpyhop as gtpyhop
import HTN.actions as actions_mod
import HTN.methods as methods_mod
import HTN.tasks   as tasks_mod
import scenario    as scenario_mod

# ══════════════════════════════════════════════════════════════════════
#  CONSTANTES
# ══════════════════════════════════════════════════════════════════════

TOLERANCE_WP         = 5.0
ACTIONS_INSTANTANEES = {"stopper", "spawn_agent"}
ACTIONS_LOOP         = {"patrouiller_zone", "suivre_agent"}

OPERATEURS = {
    "egal":               lambda a, b: a == b,
    "different":          lambda a, b: a != b,
    "superieur":          lambda a, b: float(a) >  float(b),
    "superieur_ou_egal":  lambda a, b: float(a) >= float(b),
    "inferieur":          lambda a, b: float(a) <  float(b),
    "inferieur_ou_egal":  lambda a, b: float(a) <= float(b),
    "dans":               lambda a, b: a in b,
}

# ══════════════════════════════════════════════════════════════════════
#  ÉTAT PARTAGÉ (thread route ↔ thread boucle)
# ══════════════════════════════════════════════════════════════════════

etat_exec = {
    "running":     False,
    "t":           0,
    "agents":      {},
    "plans":       {},
    "files_buts":  {},
    "log":         [],
    "log_cursor":  0,
    "evts":        [],
    "evts_cursor": 0,
}
exec_lock  = threading.Lock()
stop_event = threading.Event()

# ══════════════════════════════════════════════════════════════════════
#  DOMAINE GTPYHOP
# ══════════════════════════════════════════════════════════════════════

def charger_domaine():
    """Recharge les 3 fichiers HTN et reconstruit le domaine GTPyhop."""
    importlib.reload(actions_mod)
    importlib.reload(methods_mod)
    importlib.reload(tasks_mod)

    gtpyhop.current_domain = gtpyhop.Domain("lotusim")

    fns_actions = [fn for name, fn in inspect.getmembers(actions_mod, inspect.isfunction)
                   if not name.startswith("_")]
    if fns_actions:
        gtpyhop.declare_actions(*fns_actions)

    for nom_tache, defn in tasks_mod.TASKS.items():
        fns_methodes = []
        for nom_m in defn.get("methodes", []):
            fn = getattr(methods_mod, nom_m, None)
            if fn and callable(fn):
                fns_methodes.append(fn)
        if fns_methodes:
            gtpyhop.declare_task_methods(nom_tache, *fns_methodes)

    gtpyhop.verbose = 0


def construire_etat(agents, zones):
    state = gtpyhop.State("courant")
    state.trace = []
    state.zones  = zones
    state.x = {}; state.y = {}; state.modele = {}
    state.dispo = {}; state.phase = {}; state.waypoints_courants = {}

    for nom, ag in agents.items():
        state.x[nom]    = ag["x"]
        state.y[nom]    = ag["y"]
        state.modele[nom]  = ag["modele"]
        state.dispo[nom]   = ag.get("dispo", 1)
        state.phase[nom]   = ag.get("phase", "init")
        state.waypoints_courants[nom] = {"points": [], "loop": False}

    return state

# ══════════════════════════════════════════════════════════════════════
#  SIMULATEUR CINÉMATIQUE
# ══════════════════════════════════════════════════════════════════════

def tick_sim(agents, dt=1.0):
    for ag in agents.values():
        wps = ag.get("waypoints", [])
        if not wps or ag.get("fini", False):
            continue

        cx, cy = wps[0]
        dx, dy = cx - ag["x"], cy - ag["y"]
        dist   = math.hypot(dx, dy)

        if dist < TOLERANCE_WP:
            wps.pop(0)
            if not wps:
                if ag.get("loop", False):
                    ag["waypoints"] = list(ag.get("waypoints_origin", []))
                else:
                    ag["fini"] = True
        else:
            pas = min(ag["vitesse"] * dt, dist)
            ag["x"] += (dx / dist) * pas
            ag["y"] += (dy / dist) * pas


def envoyer_waypoints(agents, agent, waypoints, loop=False):
    if agent not in agents:
        return
    wps = [tuple(w) for w in waypoints]
    agents[agent].update({"waypoints": list(wps), "waypoints_origin": list(wps),
                           "loop": loop, "fini": False})

# ══════════════════════════════════════════════════════════════════════
#  MONITEUR D'ÉVÉNEMENTS
# ══════════════════════════════════════════════════════════════════════

def evaluer_evenements(evenements, agents, deja_declenche):
    declenches = []

    for evt in evenements:
        nom = evt["nom"]
        if nom in deja_declenche and not evt.get("rearmable", False):
            continue

        contexte, ok = {}, True
        for cond in evt["quand"]:
            if cond[0] == "distance":
                _, source, op, seuil, var_cible = cond
                if source not in agents:
                    ok = False; break

                candidats = ([contexte[var_cible]] if var_cible in contexte
                             else [n for n in agents if n != source])
                trouve = False
                for nc in candidats:
                    if nc not in agents:
                        continue
                    d = math.hypot(agents[source]["x"] - agents[nc]["x"],
                                   agents[source]["y"] - agents[nc]["y"])
                    if OPERATEURS[op](d, seuil):
                        contexte[var_cible] = nc
                        trouve = True; break
                if not trouve:
                    ok = False; break
            else:
                champ, qui_param, op, valeur = cond
                agent_nom = contexte.get(qui_param, qui_param)
                if agent_nom not in agents:
                    ok = False; break
                val = agents[agent_nom].get(champ)
                if val is None or not OPERATEURS[op](val, valeur):
                    ok = False; break

        if ok:
            if not evt.get("rearmable", False):
                deja_declenche.add(nom)
            declenches.append((evt, contexte))

    return declenches

# ══════════════════════════════════════════════════════════════════════
#  EXÉCUTEUR D'ACTIONS
# ══════════════════════════════════════════════════════════════════════

def appliquer_action(action, agents, zones):
    """Applique une action sur le fake sim. Retourne True si instantanée."""
    nom  = action[0]
    args = action[1:]

    if nom == "patrouiller_zone":
        agent, zone = args[0], args[1]
        wps = zones.get(zone, {}).get("waypoints", [])
        envoyer_waypoints(agents, agent, wps, loop=True)
        agents[agent]["phase"] = "patrouille"

    elif nom in ("aller_vers_agent", "naviguer_vers_agent"):
        agent, cible = args[0], args[1]
        if cible in agents:
            envoyer_waypoints(agents, agent, [(agents[cible]["x"], agents[cible]["y"])])
            agents[agent]["phase"] = "interception"

    elif nom == "naviguer_vers_point":
        agent = args[0]; x, y = float(args[1]), float(args[2])
        envoyer_waypoints(agents, agent, [(x, y)])
        agents[agent]["phase"] = "transit"

    elif nom == "stopper":
        agent = args[0]
        agents[agent].update({"waypoints": [], "fini": True, "phase": "arret"})

    elif nom == "spawn_agent":
        nom_drone, modele = args[0], args[1]
        x, y = float(args[2]), float(args[3])
        if nom_drone not in agents:
            agents[nom_drone] = {
                "nom": nom_drone, "modele": modele, "x": x, "y": y, "vitesse": 15.0,
                "dispo": 1, "waypoints": [], "waypoints_origin": [], "loop": False,
                "fini": False, "phase": "spawne"
            }

    elif nom == "suivre_agent":
        agent, cible = args[0], args[1]
        if cible in agents:
            envoyer_waypoints(agents, agent, [(agents[cible]["x"], agents[cible]["y"])])
            agents[agent]["phase"] = "suivi"

    return nom in ACTIONS_INSTANTANEES


def action_terminee(action, agents):
    nom   = action[0]
    agent = action[1] if len(action) > 1 else None

    if nom in ACTIONS_INSTANTANEES:
        return True
    if nom in ACTIONS_LOOP:
        return False
    if agent and agent in agents:
        return agents[agent].get("fini", False)
    return False

# ══════════════════════════════════════════════════════════════════════
#  BOUCLE D'EXÉCUTION (thread séparé)
# ══════════════════════════════════════════════════════════════════════

def boucle(buts_par_agent):
    global etat_exec

    stop_event.clear()
    importlib.reload(scenario_mod)
    charger_domaine()

    agents = {}
    for ag_def in scenario_mod.AGENTS:
        nom = ag_def["nom"]
        agents[nom] = {**ag_def,
                       "waypoints": [], "waypoints_origin": [], "loop": False, "fini": False,
                       "phase": "init"}

    zones          = scenario_mod.ZONES
    evenements     = scenario_mod.EVENEMENTS
    deja_declenche = set()
    log            = []
    evts_log       = []

    files_buts = {ag: list(buts) for ag, buts in buts_par_agent.items()}
    plans      = {ag: [] for ag in agents}

    def planifier_prochain_but(agent):
        file = files_buts.get(agent, [])
        if not file:
            return
        but   = file[0]
        state = construire_etat(agents, zones)
        plan  = gtpyhop.find_plan(state, [tuple(but)])
        if plan:
            plans[agent] = list(plan)
            log.append(f"[t={t}s] Plan {agent} : {' -> '.join(a[0] for a in plan)}")
            appliquer_action(plans[agent][0], agents, zones)
        else:
            log.append(f"[t={t}s] Pas de plan pour {but}")
            file.pop(0)

    t = 0
    for agent in agents:
        planifier_prochain_but(agent)

    while not stop_event.is_set():
        time.sleep(1.0)
        t += 1
        tick_sim(agents)

        for agent in list(agents.keys()):
            plan = plans.get(agent, [])
            if not plan:
                file = files_buts.get(agent, [])
                if file:
                    file.pop(0)
                planifier_prochain_but(agent)
                continue

            if action_terminee(plan[0], agents):
                plan.pop(0)
                if plan:
                    log.append(f"[t={t}s] -> {agent} : {plan[0][0]}")
                    appliquer_action(plan[0], agents, zones)
                else:
                    file = files_buts.get(agent, [])
                    if file:
                        file.pop(0)
                    planifier_prochain_but(agent)

        for evt, contexte in evaluer_evenements(evenements, agents, deja_declenche):
            log.append(f"[t={t}s] EVENEMENT : {evt['nom']}")
            evts_log.append({"nom": evt["nom"], "t": t})

            alors       = evt["alors"]
            but         = [contexte.get(tok, tok) for tok in alors["but"]]
            agent_cible = alors.get("agent", but[1] if len(but) > 1 else None)

            if agent_cible:
                state = construire_etat(agents, zones)
                plan  = gtpyhop.find_plan(state, [tuple(but)])
                if plan:
                    plans[agent_cible] = list(plan)
                    agents[agent_cible]["fini"] = False
                    appliquer_action(plans[agent_cible][0], agents, zones)
                    log.append(f"[t={t}s] -> Nouveau plan {agent_cible} : "
                               f"{' -> '.join(a[0] for a in plan)}")

        with exec_lock:
            etat_exec["t"]       = t
            etat_exec["running"] = True
            etat_exec["agents"]  = {
                nom: {"x": round(ag["x"], 1), "y": round(ag["y"], 1),
                      "modele": ag["modele"], "phase": ag.get("phase", "?"),
                      "fini": ag.get("fini", False)}
                for nom, ag in agents.items()
            }
            etat_exec["plans"]   = {
                ag: {"action_courante": plans[ag][0][0] if plans.get(ag) else "-",
                     "buts_restants":   len(files_buts.get(ag, []))}
                for ag in agents
            }
            etat_exec["log"]  = log
            etat_exec["evts"] = evts_log

    with exec_lock:
        etat_exec["running"] = False


# Chargement initial du domaine au démarrage du module
charger_domaine()
