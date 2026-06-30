#!/usr/bin/env python3
"""
HTN v1 - spawn des USV, surveillance réactive, interception.
"""
import math
import time
import threading
import gtpyhop
import rclpy
from rclpy.node import Node
from rclpy.action import ActionClient
from rclpy.executors import MultiThreadedExecutor
from geographic_msgs.msg import GeoPoint
from lotusim_msgs.msg import MASCmd as MASCmdMsg, VesselPositionArray
from lotusim_msgs.action import MASCmd
from lotusim_msgs.srv import SetWaypoints

# ── Config ────────────────────────────────────────────────────────────────────

_ros_node = None

DETECTION_RADIUS_DEG = 0.001  # ~1 km

AGENTS = {
    "usv_0": {
        'x': 1.2605794416293148,
        'y': 103.7516212463379,
        'model': 'wamv',
        'goal': [('veille', 'usv_0')],
    },
    "intru": {
        'x': 1.2605687153898033,
        'y': 103.74297380447389,
        'model': 'wamv',
        'goal': [('aller', 'intru', (1.2605365366710013, 103.75801563262941))],
    },
}

# ── Utilitaire : attendre un future sans bloquer l'executor ──────────────────

def _wait(fut, timeout=10.0):
    """Attend un rclpy Future depuis n'importe quel thread."""
    done = threading.Event()
    fut.add_done_callback(lambda _: done.set())
    done.wait(timeout=timeout)

# ── HTN domain ────────────────────────────────────────────────────────────────

gtpyhop.Domain('htn_v1')

def aller_m(state, agent, pos):
    return [('send_mas_cmd', agent, pos)]

def veille_m(state, agent):
    own = state.agents.get(agent)
    if own is None:
        return False
    for name, data in state.agents.items():
        if name == agent:
            continue
        dist = math.hypot(own['x'] - data['x'], own['y'] - data['y'])
        if dist < DETECTION_RADIUS_DEG:
            _ros_node.get_logger().info(
                f"[HTN] {agent} détecte {name} à {dist:.4f}° → interception")
            return [('aller', agent, (data['x'], data['y']))]
    return False

def send_mas_cmd(state, agent, pos):
    node = _ros_node
    node.get_logger().info(f"[HTN] {agent} → {pos}")

    cli = node.create_client(SetWaypoints, f"/lotusim/{agent}/waypoints")
    while not cli.wait_for_service(timeout_sec=1.0):
        node.get_logger().info(f"Attente service waypoints {agent}...")

    req = SetWaypoints.Request()
    req.path = [GeoPoint(latitude=pos[0], longitude=pos[1], altitude=0.0)]
    req.loop = False

    fut = cli.call_async(req)
    _wait(fut)
    node.get_logger().info(f"Waypoint envoyé à {agent}, success={fut.result().success}")

    state.agents[agent]['x'] = pos[0]
    state.agents[agent]['y'] = pos[1]
    return state

gtpyhop.declare_task_methods('aller', aller_m)
gtpyhop.declare_task_methods('veille', veille_m)
gtpyhop.declare_actions(send_mas_cmd)

# ── PoseTracker ───────────────────────────────────────────────────────────────

class PoseTracker:
    def __init__(self, node, state):
        self._state = state
        node.create_subscription(VesselPositionArray, "/lotusim/poses", self._cb, 10)

    def _cb(self, msg):
        for v in msg.vessels:
            if v.vessel_name in self._state.agents:
                self._state.agents[v.vessel_name]['x'] = v.geo_point.latitude
                self._state.agents[v.vessel_name]['y'] = v.geo_point.longitude

# ── ROS2 helpers ──────────────────────────────────────────────────────────────

def spawn_vessel(node, vessel, init_pos, model,
                 linear_velocities_limits=(0, 5), angular_velocities_limits=0.05):
    spawn = ActionClient(node, MASCmd, "/lotusim/mas_cmd")
    spawn.wait_for_server()

    cmd = MASCmdMsg()
    cmd.cmd_type    = MASCmdMsg.CREATE_CMD
    cmd.model_name  = model
    cmd.vessel_name = vessel
    cmd.geo_point   = GeoPoint(latitude=init_pos[0], longitude=init_pos[1], altitude=0.0)
    cmd.sdf_string  = f"""
        <lotus_param>
            <waypoint_follower>
                <follower>
                    <loop>false</loop>
                    <range_tolerance>2</range_tolerance>
                    <linear_velocities_limits>{linear_velocities_limits[0]} {linear_velocities_limits[1]}</linear_velocities_limits>
                    <angular_velocities_limits>{angular_velocities_limits}</angular_velocities_limits>
                </follower>
            </waypoint_follower>
        </lotus_param>
    """

    goal = MASCmd.Goal()
    goal.cmd = cmd

    # To know if the Lotusim server has accepted the goal
    fut = spawn.send_goal_async(goal)
    _wait(fut, timeout=10.0)
    if not fut.done() or fut.result() is None:
        raise RuntimeError(f"spawn_vessel: pas de réponse pour '{vessel}'")

    res_fut = fut.result().get_result_async()
    _wait(res_fut, timeout=10.0)
    if not res_fut.done() or res_fut.result() is None:
        raise RuntimeError(f"spawn_vessel: timeout résultat pour '{vessel}'")

    node.get_logger().info(f"Spawned: {res_fut.result().result.name}")

def run_agent(name, info, state, node):
    """Boucle de replanning pour un agent (thread séparé)."""
    goal = info['goal']
    while rclpy.ok():
        plan = gtpyhop.find_plan(state, goal)
        if plan:
            node.get_logger().info(f"[{name}] Mission accomplie : {plan}")
            break  # waypoint envoyé, mission terminée
        else:
            time.sleep(1.0)

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    global _ros_node
    rclpy.init()
    node = Node("goto_point", namespace="/lotusim")
    _ros_node = node

    executor = MultiThreadedExecutor()
    executor.add_node(node)
    executor_thread = threading.Thread(target=executor.spin, daemon=True)
    executor_thread.start()

    try:
        state = gtpyhop.State('initial_state')
        state.agents = {
            name: {'x': info['x'], 'y': info['y'], 'model': info['model']}
            for name, info in AGENTS.items()
        }

        PoseTracker(node, state)

        for name, info in AGENTS.items():
            spawn_vessel(node, name, (info['x'], info['y']), info['model'])
            time.sleep(3.0)

        threads = [
            threading.Thread(target=run_agent, args=(name, info, state, node), daemon=True)
            for name, info in AGENTS.items()
        ]
        for t in threads:
            t.start()

        for t in threads:
            t.join()

    except KeyboardInterrupt:
        pass
    finally:
        executor.shutdown()
        node.destroy_node()
        rclpy.shutdown()

if __name__ == '__main__':
    main()
