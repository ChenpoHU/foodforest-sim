use std::fs::File;
use std::io::Write;
use std::path::Path;

use ndarray::{Array2, Array3};
use tiff::decoder::{Decoder, DecodingResult};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().collect();

    if args.len() != 4 {
        eprintln!("Usage: voxelize <region> <dem.tif> <lc.tif>");
        std::process::exit(1);
    }

    let region = &args[1];
    let dem_path = &args[2];
    let lc_path = &args[3];

    let mut dem = load_geotiff(dem_path)?;
    let mut lc = load_geotiff(lc_path)?;

    let mut h = dem.nrows();
    let mut w = dem.ncols();

    let lc_h = lc.nrows();
    let lc_w = lc.ncols();

    println!("DEM size: {}x{}", w, h);

    // Crop safely
    if h != lc_h || w != lc_w {
        h = h.min(lc_h).min(100);
        w = w.min(lc_w).min(100);

        dem = dem.slice(ndarray::s![0..h, 0..w]).to_owned();
        lc = lc.slice(ndarray::s![0..h, 0..w]).to_owned();
    }

    const MAX_H: usize = 50;
    let mut voxels = Array3::<u8>::zeros((MAX_H, h, w));

    // ---------------- voxel build ----------------
    for y in 0..h {
        for x in 0..w {
            let ground = dem[[y, x]].max(0.0) as usize;
            let ground = ground.min(MAX_H - 1);

            let land = lc[[y, x]] as u8;

            for z in 0..MAX_H {
                voxels[[z, y, x]] = if z == ground {
                    2
                } else if z > ground {
                    match land {
                        10 => if z > ground + 3 { 10 } else { 3 },
                        20 => 3,
                        30 => 5,
                        _ => 0,
                    }
                } else {
                    1
                };
            }
        }
    }

    let out_dir = Path::new("voxel_data").join(region);
    std::fs::create_dir_all(&out_dir)?;

    let out_path = out_dir.join("voxels.bin");
    let mut file = File::create(&out_path)?;

    file.write_all(&(w as u32).to_le_bytes())?;
    file.write_all(&(h as u32).to_le_bytes())?;
    file.write_all(&(MAX_H as u32).to_le_bytes())?;

    for v in voxels.iter() {
        file.write_all(&[*v])?;
    }

    println!("Saved {}", out_path.display());

    Ok(())
}

fn load_geotiff(path: &str) -> Result<Array2<f32>, Box<dyn std::error::Error>> {
    let file = File::open(path)?;
    let mut decoder = Decoder::new(file)?;

    let (w, h) = decoder.dimensions()?;

    let image = decoder.read_image()?;

    let data: Vec<f32> = match image {
        DecodingResult::U8(v) => v.into_iter().map(|x| x as f32).collect(),
        DecodingResult::U16(v) => v.into_iter().map(|x| x as f32).collect(),

        DecodingResult::I16(v) => v
            .into_iter()
            .map(|x| if x == -32768 { 0.0 } else { x as f32 })
            .collect(),

        DecodingResult::I32(v) => v.into_iter().map(|x| x as f32).collect(),
        DecodingResult::F32(v) => v,
        DecodingResult::F64(v) => v.into_iter().map(|x| x as f32).collect(),

        _ => {
            return Err("Unsupported TIFF format".into());
        }
    };

    Ok(Array2::from_shape_vec((h as usize, w as usize), data)?)
}