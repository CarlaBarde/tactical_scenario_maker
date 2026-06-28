#!/usr/bin/env python3
"""
app.py — LOTUSim Poste de Commandement (routes Flask uniquement)
Lancer : python app.py  ->  http://localhost:8765
"""

import sys, os, importlib, pprint, threading

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'HTN'))

from flask import Flask, jsonify, request, render_template
from flask_cors import CORS

import HTN.gtpyhop as gtpyhop
import scenario as scenario_mod

from simulation import (
    charger_domaine, construire_etat,
    etat_exec, exec_lock, stop_event, boucle
)

app = Flask(__name__)
CORS(app)

FICHIERS_HTN = {
    "actions": os.path.join("HTN", "actions.py"),
    "methods": os.path.join("HTN", "methods.py"),
    "tasks":   os.path.join("HTN", "tasks.py"),
}
BASE = os.path.dirname(__file__)


# ══════════════════════════════════════════════════════════════════════
#  ROUTES — DOMAINE HTN
# ══════════════════════════════════════════════════════════════════════

@app.get("/api/fichier/<nom>")
def get_fichier(nom):
    if nom not in FICHIERS_HTN:
        return jsonify({"erreur": "Fichier inconnu"}), 404
    chemin = os.path.join(BASE, FICHIERS_HTN[nom])
    with open(chemin, encoding="utf-8") as f:
        return jsonify({"nom": nom, "contenu": f.read()})


@app.post("/api/fichier/<nom>")
def save_fichier(nom):
    if nom not in FICHIERS_HTN:
        return jsonify({"ok": False, "erreur": "Fichier inconnu"}), 404
    contenu = request.json.get("contenu", "")
    try:
        compile(contenu, FICHIERS_HTN[nom], "exec")
    except SyntaxError as e:
        return jsonify({"ok": False, "erreur": f"Erreur de syntaxe : {e}"})

    chemin = os.path.join(BASE, FICHIERS_HTN[nom])
    tmp = chemin + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(contenu)
    os.replace(tmp, chemin)

    try:
        charger_domaine()
    except Exception as e:
        return jsonify({"ok": False, "erreur": f"Erreur au rechargement : {e}"})

    return jsonify({"ok": True})


# ══════════════════════════════════════════════════════════════════════
#  ROUTES — SCENARIO
# ══════════════════════════════════════════════════════════════════════

@app.get("/api/scenario")
def get_scenario():
    importlib.reload(scenario_mod)
    return jsonify({
        "nom":            scenario_mod.NOM,
        "agents":         scenario_mod.AGENTS,
        "zones":          scenario_mod.ZONES,
        "buts_par_agent": scenario_mod.BUTS_PAR_AGENT,
        "evenements":     scenario_mod.EVENEMENTS,
    })


@app.post("/api/scenario")
def save_scenario():
    d = request.json
    if "agents" not in d:
        return jsonify({"ok": False, "erreur": "Cle 'agents' manquante"})

    contenu = f"""# scenario.py — genere par LOTUSim App

NOM = {repr(d.get('nom', 'sans_nom'))}

AGENTS = {pprint.pformat(d['agents'])}

ZONES = {pprint.pformat(d.get('zones', {}))}

BUTS_PAR_AGENT = {pprint.pformat(d.get('buts_par_agent', {}))}

EVENEMENTS = {pprint.pformat(d.get('evenements', []))}
"""
    try:
        compile(contenu, "scenario.py", "exec")
    except SyntaxError as e:
        return jsonify({"ok": False, "erreur": str(e)})

    chemin = os.path.join(BASE, "scenario.py")
    with open(chemin, "w", encoding="utf-8") as f:
        f.write(contenu)
    importlib.reload(scenario_mod)
    return jsonify({"ok": True})


# ══════════════════════════════════════════════════════════════════════
#  ROUTES — PLANIFICATION & EXECUTION
# ══════════════════════════════════════════════════════════════════════

@app.post("/api/preview")
def preview():
    data = request.json or {}
    buts_par_agent = data.get("buts_par_agent", {})
    importlib.reload(scenario_mod)
    try:
        charger_domaine()
    except Exception as e:
        return jsonify({"ok": False, "erreur": str(e)})

    agents_init = {ag["nom"]: ag for ag in scenario_mod.AGENTS}
    zones       = scenario_mod.ZONES
    state       = construire_etat(agents_init, zones)
    plans       = {}

    for agent, file_buts in buts_par_agent.items():
        if not file_buts:
            continue
        plan = gtpyhop.find_plan(state, [tuple(file_buts[0])])
        if plan:
            plans[agent] = [{"action": a[0], "args": list(a[1:])} for a in plan]
        else:
            plans[agent] = []

    return jsonify({"ok": True, "plans": plans})


@app.post("/api/execute")
def execute():
    if etat_exec["running"]:
        return jsonify({"ok": False, "erreur": "Deja en cours"})
    buts = request.json.get("buts_par_agent", {})
    with exec_lock:
        etat_exec["log"]         = []
        etat_exec["log_cursor"]  = 0
        etat_exec["evts"]        = []
        etat_exec["evts_cursor"] = 0
        etat_exec["t"]           = 0

    t = threading.Thread(target=boucle, args=(buts,), daemon=True)
    t.start()
    return jsonify({"ok": True})


@app.get("/api/status")
def status():
    with exec_lock:
        log_cursor  = etat_exec["log_cursor"]
        evts_cursor = etat_exec["evts_cursor"]
        nouveaux_logs = etat_exec["log"][log_cursor:]
        nouveaux_evts = etat_exec["evts"][evts_cursor:]
        etat_exec["log_cursor"]  = len(etat_exec["log"])
        etat_exec["evts_cursor"] = len(etat_exec["evts"])

        return jsonify({
            "running":             etat_exec["running"],
            "t":                   etat_exec["t"],
            "agents":              etat_exec["agents"],
            "plans_courants":      etat_exec["plans"],
            "nouveaux_logs":       nouveaux_logs,
            "nouveaux_evenements": nouveaux_evts,
        })


@app.post("/api/stop")
def stop():
    stop_event.set()
    return jsonify({"ok": True})


# ══════════════════════════════════════════════════════════════════════
#  ROUTE PRINCIPALE
# ══════════════════════════════════════════════════════════════════════

@app.get("/")
def index():
    return render_template("index.html")


if __name__ == "__main__":
    print("\nLOTUSim — Poste de Commandement")
    print("http://localhost:8765\n")
    app.run(host="127.0.0.1", port=8765, debug=False)
