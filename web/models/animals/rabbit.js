// models/animals/rabbit.js — tan body, long ears, white fluffy tail.
import * as THREE from "three";

export function buildRabbit() {
    const g = new THREE.Group();
    const furR = new THREE.MeshStandardMaterial({ color: 0xb8a088, roughness: 0.9 });
    const furW = new THREE.MeshStandardMaterial({ color: 0xe8ddd0, roughness: 0.9 });
    const dkR  = new THREE.MeshStandardMaterial({ color: 0x2a1a0a });
    const earInMat = new THREE.MeshStandardMaterial({ color: 0xddaaaa });
    const noseMat  = new THREE.MeshStandardMaterial({ color: 0xdd9999 });

    // Body + head
    const bod = new THREE.Mesh(new THREE.SphereGeometry(0.16, 7, 6), furR);
    bod.position.set(0, 0.22, 0); bod.scale.set(0.9, 0.8, 1.1);
    bod.castShadow = true; g.add(bod);
    const hd = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 5), furR);
    hd.position.set(0, 0.32, 0.16); g.add(hd);

    // Ears (long, tall) — outer + inner pink lining
    for (const s of [-1, 1]) {
        const ear = new THREE.Mesh(new THREE.CapsuleGeometry(0.025, 0.14, 4, 5), furR);
        ear.position.set(s * 0.04, 0.48, 0.12); ear.rotation.z = s * -0.15; g.add(ear);
        const earIn = new THREE.Mesh(new THREE.CapsuleGeometry(0.015, 0.1, 3, 4), earInMat);
        earIn.position.set(s * 0.04, 0.47, 0.11); earIn.rotation.z = s * -0.15; g.add(earIn);
    }

    // Face features
    for (const s of [-1, 1]) {
        const e = new THREE.Mesh(new THREE.SphereGeometry(0.015, 4, 3), dkR);
        e.position.set(s * 0.07, 0.34, 0.22); g.add(e);
    }
    const n = new THREE.Mesh(new THREE.SphereGeometry(0.015, 4, 3), noseMat);
    n.position.set(0, 0.31, 0.26); g.add(n);

    // Fluffy tail + hind legs
    const tail = new THREE.Mesh(new THREE.SphereGeometry(0.06, 5, 4), furW);
    tail.position.set(0, 0.22, -0.16); g.add(tail);
    for (const s of [-1, 1]) {
        const hl = new THREE.Mesh(new THREE.SphereGeometry(0.06, 5, 4), furR);
        hl.position.set(s * 0.1, 0.12, -0.06); hl.scale.set(0.8, 1.2, 1); g.add(hl);
        const fl = new THREE.Mesh(new THREE.SphereGeometry(0.04, 4, 3), furR);
        fl.position.set(s * 0.06, 0.1, 0.12); g.add(fl);
    }

    return g;
}
