//! NPC AI system: task queue execution for AI farmers, foresters, etc.
//! Runs every 10 ticks (500ms).

use crate::components::ai_agent::{NpcAgent, NpcTask};
use crate::components::transform::{Position, Velocity};
use crate::Resources;
use ff_voxel::VoxelWorld;
use glam::Vec3;

const NPC_SPEED: f32 = 3.0;
const ARRIVE_THRESHOLD: f32 = 1.5;

pub fn run(world: &mut hecs::World, terrain: &VoxelWorld, resources: &Resources) {
    let _tick = resources.calendar.tick.0;

    for (_entity, (npc, pos, vel)) in
        world.query_mut::<(&mut NpcAgent, &mut Position, &mut Velocity)>()
    {
        if npc.task_queue.is_empty() {
            // Default: patrol near home
            vel.0 = Vec3::ZERO;
            // Idle at home — could generate tasks based on nearby environment
            npc.task_queue.push(NpcTask::Idle {
                ticks_remaining: 100,
            });
            continue;
        }

        let task_done = match &mut npc.task_queue[0] {
            NpcTask::GoTo(target) => {
                let dir = *target - pos.0;
                let dist = dir.length();
                if dist < ARRIVE_THRESHOLD {
                    vel.0 = Vec3::ZERO;
                    true
                } else {
                    vel.0 = dir.normalize_or_zero() * NPC_SPEED;
                    // Keep on ground
                    let gy = terrain.spawn_height(pos.0.x as i32, pos.0.z as i32) as f32;
                    pos.0.y = gy;
                    false
                }
            }
            NpcTask::Idle { ticks_remaining } => {
                vel.0 = Vec3::ZERO;
                if *ticks_remaining == 0 {
                    true
                } else {
                    *ticks_remaining = ticks_remaining.saturating_sub(1);
                    false
                }
            }
            NpcTask::Plant { position, .. } => {
                // Move to position, then plant (spawning handled by interaction system)
                let dir = *position - pos.0;
                if dir.length() < ARRIVE_THRESHOLD {
                    // Plant action would be dispatched here
                    true
                } else {
                    vel.0 = dir.normalize_or_zero() * NPC_SPEED;
                    false
                }
            }
            NpcTask::Harvest { .. } | NpcTask::Water { .. } | NpcTask::Trade { .. } => {
                // Simplified: complete immediately (real impl would move to target first)
                true
            }
            NpcTask::Patrol {
                waypoints,
                current_index,
            } => {
                if waypoints.is_empty() {
                    true
                } else {
                    let target = waypoints[*current_index];
                    let dir = target - pos.0;
                    if dir.length() < ARRIVE_THRESHOLD {
                        *current_index = (*current_index + 1) % waypoints.len();
                    }
                    vel.0 = dir.normalize_or_zero() * NPC_SPEED;
                    false // patrols never complete
                }
            }
        };

        if task_done {
            npc.task_queue.remove(0);
        }
    }
}
