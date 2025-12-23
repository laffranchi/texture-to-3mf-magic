import { useRef, useMemo, Suspense } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Environment, Center, Grid } from '@react-three/drei';
import * as THREE from 'three';
import { ProcessedMesh } from '@/lib/meshProcessor';
import { rgbToHex } from '@/lib/colorQuantization';

interface OriginalModelProps {
  object: THREE.Object3D;
}

function OriginalModel({ object }: OriginalModelProps) {
  const groupRef = useRef<THREE.Group>(null);
  
  const clonedScene = useMemo(() => {
    return object.clone();
  }, [object]);

  return (
    <group ref={groupRef}>
      <primitive object={clonedScene} />
    </group>
  );
}

interface ProcessedModelProps {
  meshes: ProcessedMesh[];
}

function ProcessedModel({ meshes }: ProcessedModelProps) {
  return (
    <group>
      {meshes.map((mesh, idx) => (
        <mesh key={idx} geometry={mesh.geometry}>
          <meshStandardMaterial 
            color={rgbToHex(mesh.color)} 
            roughness={0.7}
            metalness={0.1}
          />
        </mesh>
      ))}
    </group>
  );
}

function LoadingFallback() {
  const meshRef = useRef<THREE.Mesh>(null);
  
  useFrame((state) => {
    if (meshRef.current) {
      meshRef.current.rotation.y = state.clock.elapsedTime;
    }
  });

  return (
    <mesh ref={meshRef}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="hsl(200, 100%, 50%)" wireframe />
    </mesh>
  );
}

interface ModelViewerProps {
  originalObject?: THREE.Object3D;
  processedMeshes?: ProcessedMesh[];
  showProcessed?: boolean;
  className?: string;
}

export function ModelViewer({ 
  originalObject, 
  processedMeshes, 
  showProcessed = false,
  className 
}: ModelViewerProps) {
  return (
    <div className={className}>
      <Canvas
        camera={{ position: [3, 2, 3], fov: 50 }}
        gl={{ antialias: true, preserveDrawingBuffer: true }}
      >
        <color attach="background" args={['hsl(220, 25%, 8%)']} />
        
        <ambientLight intensity={0.4} />
        <directionalLight position={[5, 5, 5]} intensity={1} />
        <directionalLight position={[-5, 3, -5]} intensity={0.5} />
        
        <Suspense fallback={<LoadingFallback />}>
          <Center>
            {showProcessed && processedMeshes ? (
              <ProcessedModel meshes={processedMeshes} />
            ) : originalObject ? (
              <OriginalModel object={originalObject} />
            ) : (
              <LoadingFallback />
            )}
          </Center>
        </Suspense>

        <Grid
          position={[0, -1.5, 0]}
          args={[10, 10]}
          cellSize={0.5}
          cellThickness={0.5}
          cellColor="hsl(220, 20%, 25%)"
          sectionSize={2}
          sectionThickness={1}
          sectionColor="hsl(200, 100%, 40%)"
          fadeDistance={15}
          fadeStrength={1}
          followCamera={false}
        />

        <OrbitControls 
          enableDamping 
          dampingFactor={0.05}
          minDistance={1}
          maxDistance={20}
        />
        
        <Environment preset="studio" />
      </Canvas>
    </div>
  );
}
