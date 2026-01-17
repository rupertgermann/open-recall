"use client";

import { useState } from "react";
import Image from "next/image";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

type DocumentImageProps = {
  imagePath: string;
  title: string;
};

export function DocumentImage({ imagePath, title }: DocumentImageProps) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="block w-full overflow-hidden rounded-xl border bg-muted/30 text-left"
          aria-label={`Open image for ${title}`}
        >
          <div className="relative aspect-[4/3] w-full">
            <Image
              src={imagePath}
              alt={title}
              fill
              className="object-cover"
              sizes="(min-width: 1024px) 320px, 100vw"
            />
          </div>
        </button>
      </DialogTrigger>
      <DialogContent className="w-[90vw] max-w-5xl border-none bg-transparent p-0">
        <DialogTitle className="sr-only">{title} image</DialogTitle>
        <DialogDescription className="sr-only">
          Full-size document image preview.
        </DialogDescription>
        <div className="relative h-[80vh] w-full">
          <Image
            src={imagePath}
            alt={title}
            fill
            className="object-contain"
            sizes="90vw"
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
