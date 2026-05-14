//! ff-voxel: Voxel terrain storage, queries, and WASM bindings.
//!
//! Preserves the original VoxelWorld from the prototype and adds terrain
//! query helpers used by the ECS (height_at, material_at, is_solid).

pub mod generate;
pub mod terrain;

#[cfg(feature = "wasm")]
use wasm_bindgen::prelude::*;

use ff_common::VoxelMaterial;
use serde::{Deserialize, Serialize};
use std::cell::RefCell;

thread_local! {
    static VOXELS: RefCell<VoxelWorld> = RefCell::new(VoxelWorld::empty());
}

#[derive(Clone, Serialize, Deserialize)]
pub struct VoxelWorld {
    pub width: u32,
    pub height: u32,
    pub depth: u32,
    pub data: Vec<u8>,
}

impl VoxelWorld {
    pub fn empty() -> Self {
        Self {
            width: 0,
            height: 0,
            depth: 0,
            data: vec![],
        }
    }

    /// Create a new world filled with air.
    pub fn new(width: u32, height: u32, depth: u32) -> Self {
        let size = (width as usize) * (height as usize) * (depth as usize);
        Self {
            width,
            height,
            depth,
            data: vec![0; size],
        }
    }

    #[inline]
    pub fn index(&self, x: u32, y: u32, z: u32) -> usize {
        (z * self.width * self.height + y * self.width + x) as usize
    }

    #[inline]
    pub fn in_bounds(&self, x: i32, y: i32, z: i32) -> bool {
        x >= 0
            && y >= 0
            && z >= 0
            && (x as u32) < self.width
            && (y as u32) < self.height
            && (z as u32) < self.depth
    }

    /// Get voxel material at integer coordinates.
    #[inline]
    pub fn get(&self, x: i32, y: i32, z: i32) -> VoxelMaterial {
        if !self.in_bounds(x, y, z) {
            return VoxelMaterial::Air;
        }
        let idx = self.index(x as u32, y as u32, z as u32);
        VoxelMaterial::from(self.data[idx])
    }

    /// Set voxel material at integer coordinates.
    #[inline]
    pub fn set(&mut self, x: i32, y: i32, z: i32, mat: VoxelMaterial) {
        if !self.in_bounds(x, y, z) {
            return;
        }
        let idx = self.index(x as u32, y as u32, z as u32);
        self.data[idx] = mat as u8;
    }

    /// Load from the binary format: [u32 width][u32 height][u32 depth][u8... data].
    pub fn from_bytes(bytes: &[u8]) -> Self {
        let width = u32::from_le_bytes(bytes[0..4].try_into().unwrap());
        let height = u32::from_le_bytes(bytes[4..8].try_into().unwrap());
        let depth = u32::from_le_bytes(bytes[8..12].try_into().unwrap());
        let data = bytes[12..].to_vec();
        Self {
            width,
            height,
            depth,
            data,
        }
    }

    /// Serialize to binary format.
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(12 + self.data.len());
        out.extend_from_slice(&self.width.to_le_bytes());
        out.extend_from_slice(&self.height.to_le_bytes());
        out.extend_from_slice(&self.depth.to_le_bytes());
        out.extend_from_slice(&self.data);
        out
    }
}

#[cfg(feature = "wasm")]
#[wasm_bindgen]
pub fn load_voxels(ptr: *const u8, len: usize) {
    let bytes = unsafe { std::slice::from_raw_parts(ptr, len) };
    let world = VoxelWorld::from_bytes(bytes);
    VOXELS.with(|v| {
        *v.borrow_mut() = world;
    });
}

#[cfg(feature = "wasm")]
#[wasm_bindgen]
pub fn get_voxel_ptr() -> *const u8 {
    VOXELS.with(|v| v.borrow().data.as_ptr())
}

#[cfg(feature = "wasm")]
#[wasm_bindgen]
pub fn get_voxel_len() -> usize {
    VOXELS.with(|v| v.borrow().data.len())
}

#[cfg(feature = "wasm")]
#[wasm_bindgen]
pub fn get_width() -> u32 {
    VOXELS.with(|v| v.borrow().width)
}

#[cfg(feature = "wasm")]
#[wasm_bindgen]
pub fn get_height() -> u32 {
    VOXELS.with(|v| v.borrow().height)
}

#[cfg(feature = "wasm")]
#[wasm_bindgen]
pub fn get_depth() -> u32 {
    VOXELS.with(|v| v.borrow().depth)
}

#[cfg(feature = "wasm")]
#[wasm_bindgen]
pub fn get_voxel(x: u32, y: u32, z: u32) -> u8 {
    VOXELS.with(|v| {
        let v = v.borrow();
        v.data[v.index(x, y, z)]
    })
}
