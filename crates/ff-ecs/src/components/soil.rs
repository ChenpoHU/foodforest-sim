use serde::{Deserialize, Serialize};

/// Soil state for a single voxel column at a given depth layer.
///
/// Stored in a separate spatial grid (not as ECS entities) for cache efficiency.
/// This struct is used when soil blocks ARE entities (e.g., player-modified soil).
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct SoilBlock {
    /// Nitrogen content (ppm equivalent, 0..100).
    pub nitrogen: f32,
    /// Phosphorus content.
    pub phosphorus: f32,
    /// Potassium content.
    pub potassium: f32,
    /// Organic matter fraction (0.0..1.0).
    pub organic_matter: f32,
    /// Moisture fraction (0.0..1.0).
    pub moisture: f32,
    /// Soil pH (4.0..9.0).
    pub ph: f32,
    /// Compaction (0.0..1.0, where 1.0 = fully compacted).
    pub compaction: f32,
    /// Mycorrhizal fungal network connectivity (0.0..1.0).
    pub mycorrhizal_network: f32,
}

impl SoilBlock {
    /// Default Mediterranean soil (slightly alkaline, moderate fertility).
    pub fn mediterranean_default() -> Self {
        Self {
            nitrogen: 15.0,
            phosphorus: 10.0,
            potassium: 20.0,
            organic_matter: 0.03,
            moisture: 0.25,
            ph: 7.2,
            compaction: 0.3,
            mycorrhizal_network: 0.0,
        }
    }

    /// Rich forest soil (high organic matter, established fungal network).
    pub fn forest_soil() -> Self {
        Self {
            nitrogen: 40.0,
            phosphorus: 25.0,
            potassium: 35.0,
            organic_matter: 0.15,
            moisture: 0.45,
            ph: 6.5,
            compaction: 0.1,
            mycorrhizal_network: 0.6,
        }
    }
}

impl Default for SoilBlock {
    fn default() -> Self {
        Self::mediterranean_default()
    }
}

/// Spatial grid of soil blocks (chunk-sized, SOIL_LAYERS deep).
pub struct SoilGrid {
    pub width: usize,
    pub depth: usize,
    pub layers: usize,
    pub data: Vec<SoilBlock>,
}

impl SoilGrid {
    pub fn new(width: usize, depth: usize, layers: usize) -> Self {
        let size = width * depth * layers;
        Self {
            width,
            depth,
            layers,
            data: vec![SoilBlock::default(); size],
        }
    }

    #[inline]
    fn index(&self, x: usize, z: usize, layer: usize) -> usize {
        layer * self.width * self.depth + z * self.width + x
    }

    pub fn get(&self, x: usize, z: usize, layer: usize) -> &SoilBlock {
        &self.data[self.index(x, z, layer)]
    }

    pub fn get_mut(&mut self, x: usize, z: usize, layer: usize) -> &mut SoilBlock {
        let idx = self.index(x, z, layer);
        &mut self.data[idx]
    }

    /// Get the surface soil (layer 0) at position.
    pub fn surface(&self, x: usize, z: usize) -> &SoilBlock {
        self.get(x, z, 0)
    }

    pub fn surface_mut(&mut self, x: usize, z: usize) -> &mut SoilBlock {
        self.get_mut(x, z, 0)
    }
}
