import { cn } from "@/lib/utils";
import type { Experimental_GeneratedImage } from "ai";
import NextImage from "next/image";

export type ImageProps = Experimental_GeneratedImage & {
  className?: string;
  alt?: string;
  containerClassName?: string;
  caption?: string;
};

export const Image = ({
  className,
  containerClassName,
  caption,
  base64,
  mediaType,
  alt,
}: ImageProps) => {
  const src = `data:${mediaType};base64,${base64}`;

  return (
    <figure className={cn("flex flex-col gap-2", containerClassName)}>
      <NextImage
        alt={alt ?? ""}
        className={cn("h-auto max-w-full overflow-hidden rounded-md", className)}
        height={512}
        src={src}
        width={512}
      />
      {caption ? (
        <figcaption className="text-xs text-muted-foreground">{caption}</figcaption>
      ) : null}
    </figure>
  );
};
