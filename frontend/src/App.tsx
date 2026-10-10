import { NavLink, Navigate, Outlet, Route, Routes } from "react-router";

import { ProxyDisclaimer } from "./components/ProxyDisclaimer";
import { SystemStatus } from "./components/SystemStatus";
import { TokenSettings } from "./components/TokenSettings";
import { BatchCreatePanel } from "./features/batches/BatchCreatePanel";
import { BatchDetail } from "./features/batches/BatchDetail";
import { BatchList } from "./features/batches/BatchList";
import { DatasetDetail } from "./features/datasets/DatasetDetail";
import { DatasetList } from "./features/datasets/DatasetList";
import { UploadPanel } from "./features/datasets/UploadPanel";
import { DesignDetail } from "./features/designs/DesignDetail";
import { ViewerPage } from "./features/viewer/ViewerPage";

function navClass({ isActive }: { isActive: boolean }) {
  return isActive ? "font-semibold text-slate-900" : "text-slate-500 hover:text-slate-800";
}

function Layout() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <h1 className="text-xl font-bold">OrigamiEvolve</h1>
          <nav className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <NavLink to="/datasets" className={navClass}>
              Datasets
            </NavLink>
            <NavLink to="/batches" className={navClass}>
              Batch Optimization
            </NavLink>
            <NavLink to="/viewer" className={navClass}>
              3D Viewer
            </NavLink>
            <NavLink to="/status" className={navClass}>
              System status
            </NavLink>
          </nav>
          <div className="ml-auto">
            <TokenSettings />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6">
        <ProxyDisclaimer />
        <Outlet />
      </main>
    </div>
  );
}

function DatasetsPage() {
  return (
    <>
      <UploadPanel />
      <DatasetList />
    </>
  );
}

function BatchesPage() {
  return (
    <>
      <BatchCreatePanel />
      <BatchList />
    </>
  );
}

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to="/datasets" replace />} />
        <Route path="datasets" element={<DatasetsPage />} />
        <Route path="datasets/:datasetId" element={<DatasetDetail />} />
        <Route path="designs/:designId" element={<DesignDetail />} />
        <Route path="batches" element={<BatchesPage />} />
        <Route path="batches/:batchId" element={<BatchDetail />} />
        <Route path="viewer" element={<ViewerPage />} />
        <Route path="status" element={<SystemStatus />} />
        <Route path="*" element={<p className="text-sm text-slate-500">Page not found.</p>} />
      </Route>
    </Routes>
  );
}
