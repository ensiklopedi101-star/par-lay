import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

interface AdminPasswordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (password: string) => void;
}

export function AdminPasswordDialog({ open, onOpenChange, onSubmit }: AdminPasswordDialogProps) {
  const [pwd, setPwd] = useState("");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Admin Password Required</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Masukkan admin password untuk menjalankan aksi ini. Password akan disimpan di browser
            Anda selama sesi ini.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label htmlFor="admin-password">Password</Label>
            <Input
              id="admin-password"
              type="password"
              value={pwd}
              onChange={(e) => setPwd(e.target.value)}
              placeholder="Admin password"
              onKeyDown={(e) => {
                if (e.key === "Enter" && pwd) onSubmit(pwd);
              }}
            />
          </div>
          <Button onClick={() => onSubmit(pwd)} disabled={!pwd} className="w-full">
            Confirm
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
