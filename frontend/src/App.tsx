import { Compass } from "lucide-react";
import { Link, Route, Routes } from "react-router";

import { AppShell } from "./components/AppShell";
import { SystemStatus } from "./components/SystemStatus";
import { ThemeProvider } from "./components/ThemeContext";
import { buttonClass } from "./components/ui/Button";
import { EmptyState, PageHeader } from "./components/ui/Feedback";
import { ToastProvider } from "./components/ui/Toast";
import { BatchCreatePanel } from "./features/batches/BatchCreatePanel";
import { BatchDetail } from "./features/batches/BatchDetail";
import { BatchList } from "./features/batches/BatchList";
import { DatasetDetail } from "./features/datasets/DatasetDetail";
import { DatasetList } from "./features/datasets/DatasetList";
import { UploadPanel } from "./features/datasets/UploadPanel";
import { DesignDetail } from "./features/designs/DesignDetail";
import { OverviewPage } from "./features/overview/OverviewPage";
import { StructuresPage } from "./features/structures/StructuresPage";
import { ViewerPage } from "./features/viewer/ViewerPage";

function DatasetsPage() {
  return (
    <>
      <PageHeader
        title="Datasets"
        description="Upload design files, review their validation reports and browse the stored designs."
      />
      <UploadPanel />
      <DatasetList />
    </>
  );
}

function BatchesPage() {
  return (
    <>
      <PageHeader
        title="Batch Optimization"
        description="Run one independent optimization job per design and follow the jobs live."
      />
      <BatchCreatePanel />
      <BatchList />
    </>
  );
}

function NotFound() {
  return (
    <EmptyState
      icon={<Compass className="size-5" />}
      title="Page not found."
      action={
        <Link to="/" className={buttonClass("primary")}>
          Go to Overview
        </Link>
      }
    />
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<OverviewPage />} />
            <Route path="datasets" element={<DatasetsPage />} />
            <Route path="datasets/:datasetId" element={<DatasetDetail />} />
            <Route path="designs/:designId" element={<DesignDetail />} />
            <Route path="batches" element={<BatchesPage />} />
            <Route path="batches/:batchId" element={<BatchDetail />} />
            <Route path="structures" element={<StructuresPage />} />
            <Route path="viewer" element={<ViewerPage />} />
            <Route path="status" element={<SystemStatus />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </ToastProvider>
    </ThemeProvider>
  );
}
