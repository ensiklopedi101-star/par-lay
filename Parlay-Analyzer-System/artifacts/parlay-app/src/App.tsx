import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/layout";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/dashboard";
import Fixtures from "@/pages/fixtures";
import Teams from "@/pages/teams";
import Standings from "@/pages/standings";
import SettingsPage from "@/pages/settings";
import AILearning from "@/pages/ai-learning";
import Transparency from "@/pages/transparency";
import AICenter from "@/pages/ai-center";

const queryClient = new QueryClient();

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/transparency" component={Transparency} />
        <Route path="/fixtures" component={Fixtures} />
        <Route path="/teams" component={Teams} />
        <Route path="/standings" component={Standings} />
        <Route path="/ai-center">
          <AICenter defaultTab="predictions" />
        </Route>
        {/* Tautan lama tetap hidup, tetapi kini membuka pusat AI terpadu. */}
        <Route path="/risk-center">
          <AICenter defaultTab="predictions" />
        </Route>
        <Route path="/parlays">
          <AICenter defaultTab="parlays" />
        </Route>
        <Route path="/settings" component={SettingsPage} />
        <Route path="/ai-learning" component={AILearning} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
