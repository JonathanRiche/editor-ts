import type { PageBody, Asset } from '../types';

/**
 * Manager for handling assets
 */
export class AssetManager {
  private body: PageBody;
  private assets: Asset[];

  constructor(body: PageBody) {
    this.body = body;
    this.assets = body.assets || [];
  }

  /**
   * Find assets by type
   */
  findByType(type: Asset['type']): Asset[] {
    return this.assets.filter((asset) => asset.type === type);
  }

  /**
   * Find assets by source URL
   */
  findBySource(src: string): Asset[] {
    return this.assets.filter((asset) => asset.src === src || asset.src.includes(src));
  }

  /**
   * Find asset by exact source URL
   */
  findByExactSource(src: string): Asset | null {
    const asset = this.assets.find((asset) => asset.src === src);
    return asset || null;
  }

  /**
   * Add a new asset
   */
  addAsset(asset: Asset): void {
    this.assets.push(asset);
  }

  /**
   * Remove asset by source URL
   */
  removeAsset(src: string): boolean {
    const initialLength = this.assets.length;
    this.assets = this.assets.filter((asset) => asset.src !== src);
    return this.assets.length < initialLength;
  }

  /**
   * Update an asset
   */
  updateAsset(src: string, updates: Partial<Asset>): boolean {
    const asset = this.assets.find((a) => a.src === src);
    if (asset) {
      Object.assign(asset, updates);
      return true;
    }
    return false;
  }

  /**
   * Get all assets
   */
  getAll(): Asset[] {
    return this.assets;
  }

  /**
   * Get all image assets
   */
  getImages(): Asset[] {
    return this.findByType('image');
  }

  /**
   * Get all video assets
   */
  getVideos(): Asset[] {
    return this.findByType('video');
  }

  /**
   * Get all audio assets
   */
  getAudio(): Asset[] {
    return this.findByType('audio');
  }

  /**
   * Get all document assets
   */
  getDocuments(): Asset[] {
    return this.findByType('document');
  }

  /**
   * Get asset count
   */
  count(): number {
    return this.assets.length;
  }

  /**
   * Get assets from CDN
   */
  getCDNAssets(): Asset[] {
    return this.assets.filter((asset) => asset.blinkCDN === true);
  }

  /**
   * Sync changes back to page body
   */
  sync(): void {
    this.body.assets = this.assets;
  }

  /**
   * Replace all assets
   */
  replaceAll(assets: Asset[]): void {
    this.assets = assets;
  }
}
